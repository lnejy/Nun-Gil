// ui/ai/프롬프트.js
// 프롬프트는 여기에서만 관리한다.

export function createConceptExtractPrompt({
  title,
  context,
  estimatedPageCount = 10,
}) {
  const conceptTarget = Math.min(
  Math.max(Math.ceil(estimatedPageCount * 1.2), 8),
  20
);
  return `
너는 업로드된 PDF 문서만 근거로 학습 개념을 추출하는 시스템이다.

JSON이 길어질 것 같으면:

- 각 definition은 1문장만 작성한다.
- importance는 1문장만 작성한다.
- relations는 최대 3개만 작성한다.
- 각 relations 항목은 20자 내외로 짧게 작성한다.
- JSON이 길어질 것 같으면 concept 개수를 줄인다.
- 반드시 완전히 닫힌 JSON 배열만 출력한다.

규칙:
- 반드시 [선별된 문서 chunk] 안의 내용만 사용한다.
- 문서에 없는 내용은 추가하지 않는다.
- 단순 키워드가 아니라 학습에 필요한 개념을 추출한다.
- 출력은 JSON 배열만 반환한다.
- 모든 개념에는 실제 chunk_id를 source_chunks에 넣는다.

사례(예시) 처리 규칙:
- 구체 사례가 개념 설명의 중심이면 반드시 하나의 concept로 추출한다.
- 사례는 단순 relations에만 넣지 말고, 필요하면 concept 자체로 만든다.
- concept 이름은 사례와 개념을 함께 드러낸다.
- 각 사례가 어떤 추상 개념을 설명하는지 definition에 명시한다.

개념 추출 기준:
- 정의
- 절차
- 상태 변화
- 원인과 결과
- 비교 관계
- 계층 구조
- 사례
- 주의사항
- 흐름 설명
이 존재하면 우선적으로 추출한다.

importance 작성 규칙:
- "중요하다", "핵심이다" 같은 추상 표현 금지
- 이 개념을 모르면 무엇을 이해할 수 없는지 구체적으로 작성한다.
- 학습 흐름에서 어떤 역할인지 설명한다.

relations 작성 규칙:
- 단순 키워드 나열 금지
- 관계 의미가 드러나게 작성한다.
- 예시:
  - "트랜잭션의 하위 메커니즘"
  - "AOP가 사용하는 도구"
  - "상태 전환 이후 발생하는 과정"
  - "비교 대상 개념"


[문서 제목]
${title}

[선별된 문서 chunk]
${context}

출력 형식:
[
  {
    "concept": "개념명",
    "definition": "문서 기반 정의 또는 설명",
    "importance": "왜 중요한지",
    "relations": ["관련 개념1", "관련 개념2"],
    "source_chunks": ["c0001"]
  }
]

조건:
- 핵심 개념은 ${conceptTarget}개 추출한다.
- 정의, 절차, 비교, 상태 변화, 주의사항, 사례가 있으면 반드시 반영한다.
- 설명 가능한 경우 정의와 관계를 충분히 작성한다.
- 너무 짧은 단답형 설명 금지.
`;
}

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
- 개념 → 이유 → 예시 순서로 설명한다.
- JSON으로 출력하지 않는다.
- 코드블록을 사용하지 않는다.
- 반드시 markdown 본문만 출력한다.

출력 형식:
# 핵심 개념
설명

## 왜 중요한가
설명

## 동작 흐름
1. 설명
2. 설명
3. 설명

> 시험 핵심 포인트

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
- 선택지는 반드시 options 배열 안에 작성한다.
- 정답은 반드시 answerIndexes 배열로 작성한다.
- answerIndexes에는 options 배열의 정답 인덱스만 넣는다.
- 인덱스는 0부터 시작한다.
- answerIndexes 값은 반드시 1개 또는 2개만 넣는다.
- answerIndexes가 1개이면 "하나만 고르시오" 문제다.
- answerIndexes가 2개이면 "두 개 고르시오" 문제다.
- 두 개 고르시오 문제에서는 정답이 정확히 2개여야 한다.

선지별 해설 규칙:
- optionExplanations는 options와 같은 순서로 정확히 4개 작성한다.
- 각 optionExplanations는 해당 선택지 하나에 대한 설명이어야 한다.
- 정답 선택지의 해설에는 왜 이 선택지가 정답인지 설명한다.
- 오답 선택지의 해설에는 단순히 "틀렸다"라고 쓰지 말고, 그 선택지가 무엇을 의미하는지 또는 어떤 상황에서 쓰이는 개념인지 설명한 뒤, 왜 이 문제의 정답은 아닌지 설명한다.
- 모든 optionExplanations가 서로 달라야 한다.
- 문제 전체 해설 explanation을 그대로 반복하지 않는다.
- 문서에서 해당 선택지의 개념을 확인하기 어렵다면 "문서에서 이 선택지의 구체적 설명은 확인하기 어렵지만, 이 문제의 정답 조건과는 맞지 않는다."라고 작성한다.

목표:
- 핵심 개념, 정의, 차이점, 절차, 주의사항 중심으로 문제를 만든다.
- 단순 암기 문제와 이해 확인 문제를 섞어서 만든다.
- 일부 문제는 정답이 2개인 복수 선택 문제로 만든다.
- 너무 지엽적인 표현보다 문서의 핵심 내용을 확인할 수 있는 문제를 만든다.

[문서 제목]
${title}

[문서 chunk]
${context}

출력 형식:
[
  {
    "question": "문제",
    "options": ["선택지1", "선택지2", "선택지3", "선택지4"],
    "answerIndexes": [0],
    "explanation": "정답이 왜 맞는지, 오답과 비교했을 때 어떤 점이 다른지 문서 내용을 근거로 2~3문장으로 자세히 설명",
    "optionExplanations": [
      "선택지1이 정답 또는 오답인 이유와 해당 개념 설명",
      "선택지2가 정답 또는 오답인 이유와 해당 개념 설명",
      "선택지3이 정답 또는 오답인 이유와 해당 개념 설명",
      "선택지4가 정답 또는 오답인 이유와 해당 개념 설명"
    ],
    "source_chunks": ["c0001"]
  },
  {
    "question": "다음 중 문서 내용과 일치하는 것을 두 개 고르시오.",
    "options": ["선택지1", "선택지2", "선택지3", "선택지4"],
    "answerIndexes": [0, 2],
    "explanation": "문제 전체에 대한 짧은 해설",
    "optionExplanations": [
      "선택지1이 정답인 이유",
      "선택지2가 오답인 이유와 이 선택지가 의미하는 개념",
      "선택지3이 정답인 이유",
      "선택지4가 오답인 이유와 이 선택지가 의미하는 개념"
    ],
    "source_chunks": ["c0002"]
  }
]

조건:
- 문제는 정확히 5개 만든다.
- 선택지는 반드시 4개다.
- 5문제 중 3~4문제는 answerIndexes가 1개인 문제로 만든다.
- 5문제 중 1~2문제는 answerIndexes가 2개인 문제로 만든다.
- answerIndexes의 각 숫자는 0, 1, 2, 3 중 하나여야 한다.
- answerIndexes 안의 숫자는 중복되면 안 된다.
- optionExplanations는 반드시 4개 작성한다.
- optionExplanations의 각 문장은 1~2문장으로 작성한다.
- explanation은 반드시 2~3문장으로 작성한다.
- 정답이 왜 맞는지 먼저 설명한다.
- 오답과 비교했을 때 핵심 차이가 무엇인지 설명한다.
- 문서 내용에 근거해서 학습자가 다시 이해할 수 있게 구체적으로 작성한다.
`;
}
