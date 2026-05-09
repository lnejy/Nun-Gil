import json
import sys
from pathlib import Path

from docling.datamodel.pipeline_options import PdfPipelineOptions
from docling.document_converter import DocumentConverter, PdfFormatOption
from docling.datamodel.base_models import InputFormat

pipeline_options = PdfPipelineOptions()
pipeline_options.do_ocr = False
pipeline_options.do_table_structure = True

converter = DocumentConverter(
    format_options={
        InputFormat.PDF: PdfFormatOption(
            pipeline_options=pipeline_options
        )
    }
)

def main():
    if len(sys.argv) < 3:
        print("사용법: python scripts/analyze_pdf_docling_demo.py input.pdf output.json")
        sys.exit(1)

    input_pdf = sys.argv[1]
    output_json = Path(sys.argv[2])

    output_json.parent.mkdir(parents=True, exist_ok=True)

    # ★ 여기서 기존 converter 재사용
    result = converter.convert(input_pdf)

    doc = result.document

    data = {
        "source": input_pdf,
        "markdown": doc.export_to_markdown(),
        "text": doc.export_to_text(),
        "json": doc.export_to_dict(),
    }

    output_json.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )

    print(f"완료: {output_json}")


if __name__ == "__main__":
    main()