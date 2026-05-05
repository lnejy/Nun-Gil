// ui/ai/프롬프트.js
// 프롬프트는 여기에서만 관리한다.

export function createSummaryPrompt({ title, context }) {
  return `
너는 업로드된 PDF 문서만 근거로 학습 요약을 생성하는 시스템이다.

규칙:
- 반드시 [문서 chunk] 안의 내용만 사용한다.
- 문서에 없는 내용은 추측하지 않는다.
- 근거가 부족하면 "문서에서 확인 불가"라고 작성한다.
- 출력은 JSON 객체만 반환한다.
- JSON 앞뒤에 설명, markdown, 코드블록을 붙이지 않는다.
- 모든 key_points에는 실제 chunk_id를 source_chunks에 넣는다.
- 같은 내용을 반복하지 않는다.

목표:
- 시험 대비에 도움이 되도록 핵심 개념, 정의, 절차, 차이점, 주의사항 중심으로 요약한다.

[문서 제목]
${title}

[문서 chunk]
${context}

출력 형식:
{
  "title": "문서 제목",
  "summary": "문서 전체 요약 5문장",
  "key_points": [
    {
      "id": "s1",
      "title": "핵심 내용",
      "description": "설명 2~3문장",
      "source_chunks": ["c0001"]
    }
  ]
}

조건:
- key_points는 정확히 5개 만든다.
`;
}

export function createSummaryExplainPrompt({ point, sourceTexts }) {
  return `
너는 업로드된 문서만 근거로 설명하는 학습 도우미다.

규칙:
- 아래 근거 chunk만 사용한다.
- 문서에 없는 내용은 절대 추가하지 않는다.
- 반드시 구체적으로 설명한다.
- 최소 5문장 이상으로 설명한다.
- 개념 → 이유 → 예시 순서로 설명한다.

[요약 항목]
${point.title}
${point.description}

[근거 chunk]
${sourceTexts}

이 내용을 강의하듯이 자세히 설명해라.
`;
}

export function createMindmapPrompt({ title, context }) {
  return `
너는 업로드된 PDF 문서만 근거로 학습용 마인드맵 JSON을 생성하는 시스템이다.

규칙:
- 반드시 [문서 chunk] 안의 내용만 사용한다.
- 문서에 없는 내용은 추측하지 않는다.
- 근거가 부족한 개념은 만들지 않는다.
- 출력은 JSON 객체만 반환한다.
- JSON 앞뒤에 설명, markdown, 코드블록을 붙이지 않는다.
- 모든 노드에는 실제 chunk_id를 source_chunks에 넣는다.
- 같은 개념을 중복 생성하지 않는다.

목표:
- 문서의 핵심 개념을 상위 개념 → 하위 개념 → 세부 개념 구조로 정리한다.
- 학습자가 문서 구조를 빠르게 이해할 수 있도록 만든다.

[문서 제목]
${title}

[문서 chunk]
${context}

출력 형식:
{
  "name": "문서 제목",
  "detail": "문서 전체 설명",
  "source_chunks": [],
  "children": [
    {
      "name": "핵심 개념",
      "detail": "개념 설명",
      "source_chunks": ["c0001"],
      "children": []
    }
  ]
}

조건:
- 최대 3단계까지만 만든다.
- 최상위 핵심 개념은 4~6개 만든다.
- 각 노드의 name은 15자 이내로 짧게 작성한다.
`;
}

export function createQuizPrompt({ title, context }) {
  return `
너는 업로드된 PDF 문서만 근거로 시험 대비 객관식 퀴즈를 생성하는 시스템이다.

규칙:
- 반드시 [문서 chunk] 안의 내용만 사용한다.
- 문서에 없는 상식 문제는 만들지 않는다.
- 근거가 부족하면 문제로 만들지 않는다.
- 출력은 JSON 배열만 반환한다.
- JSON 앞뒤에 설명, markdown, 코드블록을 붙이지 않는다.
- 모든 문제에는 실제 chunk_id를 source_chunks에 넣는다.
- 정답은 choices 안에 있는 문자열과 완전히 일치해야 한다.

목표:
- 핵심 개념, 정의, 차이점, 절차, 주의사항 중심으로 문제를 만든다.
- 단순 암기 문제와 이해 확인 문제를 섞어서 만든다.

[문서 제목]
${title}

[문서 chunk]
${context}

출력 형식:
[
  {
    "question": "문제",
    "options": ["선택지1", "선택지2", "선택지3", "선택지4"],
    "answerIndex": 0,
    "explanation": "문서 근거 기반 해설",
    "source_chunks": ["c0001"]
  }
]

조건:
- 문제는 정확히 5개 만든다.
- 선택지는 반드시 4개다.
- answerIndex는 options 배열의 정답 인덱스(0~3)다.
`;
}
