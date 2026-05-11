"""
눈길 Layout Analysis API Server
PDF를 받아 레이아웃 분석(analyze_pdf.py) 후 Supabase Storage에 결과를 저장합니다.

실행:
    cd api && uvicorn server:app --reload --port 8000

환경변수 (.env 또는 직접 설정):
    SUPABASE_URL             - Supabase 프로젝트 URL
    SUPABASE_SERVICE_ROLE_KEY - 서비스 롤 키 (Storage 읽기/쓰기용)
"""

import asyncio
import json
import os
import sys
import tempfile
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from supabase import create_client

load_dotenv(Path(__file__).parent.parent / ".env.local")

sys.path.insert(0, str(Path(__file__).parent.parent / "scripts"))

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
BUCKET = "documents"

app = FastAPI(title="눈길 Layout API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["POST", "GET", "OPTIONS"],
    allow_headers=["*"],
)


class AnalyzeRequest(BaseModel):
    document_id: str
    storage_path: str  # Supabase Storage 내 PDF 경로


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/api/analyze")
async def analyze_layout(
    body: AnalyzeRequest,
    authorization: str = Header(...),
):
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        raise HTTPException(500, "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수가 설정되지 않았습니다.")

    doc_id = body.document_id
    storage_path = body.storage_path

    sb = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    # 요청자가 유효한 Supabase 사용자인지 확인
    token = authorization.removeprefix("Bearer ").strip()
    user_sb = create_client(SUPABASE_URL, token)
    user_resp = user_sb.auth.get_user()
    if not user_resp or not user_resp.user:
        raise HTTPException(401, "유효하지 않은 인증 토큰입니다.")

    # 1. PDF 다운로드
    try:
        pdf_bytes = sb.storage.from_(BUCKET).download(storage_path)
    except Exception as e:
        raise HTTPException(500, f"PDF 다운로드 실패: {e}")

    if not pdf_bytes:
        raise HTTPException(500, "PDF 다운로드 결과가 비어 있습니다.")

    # 2. 임시 디렉터리에서 분석 실행
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp = Path(tmpdir)
        pdf_path = tmp / "input.pdf"
        pdf_path.write_bytes(pdf_bytes)

        page_dir = tmp / "pages"
        ocr_dir = tmp / "ocr"
        page_dir.mkdir()
        ocr_dir.mkdir()

        # CPU-bound 작업은 스레드풀에서 실행 (이벤트 루프 블로킹 방지)
        loop = asyncio.get_event_loop()
        try:
            layout = await loop.run_in_executor(
                None,
                lambda: _run_analysis(str(pdf_path), page_dir, ocr_dir),
            )
        except Exception as e:
            raise HTTPException(500, f"레이아웃 분석 실패: {e}")

        # 3. 페이지 이미지 → Storage 업로드, background URL 교체
        for page in layout["pages"]:
            page_num = page["page"]
            local_img = page_dir / f"page_{page_num}.png"

            if not local_img.exists():
                continue

            img_key = f"layouts/{doc_id}/pages/page_{page_num}.png"
            try:
                sb.storage.from_(BUCKET).upload(
                    img_key,
                    local_img.read_bytes(),
                    {"content-type": "image/png", "upsert": "true"},
                )
                page["background"] = sb.storage.from_(BUCKET).get_public_url(img_key)
            except Exception as e:
                # 이미지 업로드 실패는 경고만 (분석 결과는 유지)
                print(f"[WARN] page {page_num} 이미지 업로드 실패: {e}")

        # 4. layout.json → Storage 업로드
        layout_key = f"layouts/{doc_id}/layout.json"
        layout_bytes = json.dumps(layout, ensure_ascii=False).encode("utf-8")
        try:
            sb.storage.from_(BUCKET).upload(
                layout_key,
                layout_bytes,
                {"content-type": "application/json", "upsert": "true"},
            )
        except Exception as e:
            raise HTTPException(500, f"layout.json 업로드 실패: {e}")

        layout_url = sb.storage.from_(BUCKET).get_public_url(layout_key)

        # 5. documents 테이블 layout_path 갱신
        try:
            sb.table("documents").update({"layout_path": layout_key}).eq("id", doc_id).execute()
        except Exception as e:
            # DB 업데이트 실패는 클라이언트에서 재시도 가능 → 경고만
            print(f"[WARN] documents layout_path 업데이트 실패: {e}")

        return {
            "success": True,
            "layout_url": layout_url,
            "layout_path": layout_key,
            "page_count": layout["page_count"],
        }


def _run_analysis(pdf_path: str, page_dir: Path, ocr_dir: Path) -> dict:
    from analyze_pdf import analyze_pdf
    return analyze_pdf(pdf_path, page_dir=page_dir, ocr_dir=ocr_dir)
