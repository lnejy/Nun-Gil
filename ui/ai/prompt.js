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
- 근거 chunk가 부족하더라도 추측하지 말고, 확인 가능한 범위 안에서만 설명한다.

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

절대 규칙:
- 아래 [근거 chunk]에 있는 내용만 사용한다.
- 문서에 없는 내용은 절대 추가하지 않는다.
- JSON으로 출력하지 않는다.
- HTML 태그를 직접 작성하지 않는다.
- 반드시 markdown 본문만 출력한다.
- 설명은 한국어로 작성한다.
- 너무 짧게 요약하지 말고, 학습자가 이해할 수 있게 강의하듯이 설명한다.
- 요약 카드에 이미 나온 기본 정의나 핵심 설명을 반복하지 않는다.
- "개념 설명" 영역은 작성하지 않는다.
- 설명은 "왜 중요한가", "동작 흐름", "코드 또는 예시", "시험 핵심 포인트" 중심으로 작성한다.

markdown 작성 규칙:
- 각 영역 제목은 반드시 ## 제목 형식으로 작성한다.
- 각 영역 사이에는 반드시 --- 구분선을 넣는다.
- 목록이 필요한 부분은 - 또는 1. 2. 3. 형식으로 작성한다.
- 중요한 개념명은 **굵게** 표시한다.
- 코드, 명령어, 함수명, 파일명, 변수명, CSS 선택자, HTML 태그, JavaScript 코드가 나오면 markdown 코드 형식으로 구분한다.

코드 표시 규칙:
- 여러 줄 코드는 반드시 백틱 3개짜리 코드블록으로 작성한다.
- 코드블록에는 가능한 경우 언어명을 붙인다.
  - JavaScript 코드는 \`\`\`js
  - HTML 코드는 \`\`\`html
  - CSS 코드는 \`\`\`css
  - Python 코드는 \`\`\`python
  - 명령어는 \`\`\`bash
- 한 줄짜리 코드, 함수명, 변수명, 파일명은 인라인 코드로 작성한다.
  - 예: \`renderSummary()\`, \`ai-inline-explain\`, \`summary.js\`
- 코드가 아닌 설명 문장은 코드블록 안에 넣지 않는다.
- 근거 chunk에 실제 코드가 없으면 억지로 코드 예시를 만들지 않는다.
- 코드가 없을 경우 "코드 또는 예시" 영역은 작성하지 않는다.
- 출력 형식 예시에 있는 영역이라도, 근거 chunk에 해당 내용이 없으면 작성하지 않는다.

출력 형식:

## 왜 중요한가
이 개념을 알아야 하는 이유를 학습 흐름과 연결해서 설명한다.

---

## 동작 흐름
1. 첫 번째 흐름
2. 두 번째 흐름
3. 세 번째 흐름

---

## 코드 또는 예시
근거 chunk에 실제 코드, 명령어, 함수명, 파일명, 변수명, CSS 선택자 등이 있을 때만 이 영역을 작성한다.
해당 내용이 없으면 이 영역 전체를 생략한다.

---

## 시험 핵심 포인트
- 시험에 나올 만한 핵심을 정리한다.
- 헷갈리기 쉬운 부분을 정리한다.
- 문서 내용 기준으로 구분해야 할 점을 정리한다.

[요약 항목]
${point.title}
${point.description}

[근거 chunk]
${sourceTexts}

위 내용을 markdown 형식으로만 출력해라.
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

// 선택한 문제 수, 난이도, 유형에 맞춰 퀴즈 생성 프롬프트
export function createQuizPrompt({
  title,
  context,
  questionCount = 5,
  difficulty = "normal",
  types = ["MULTIPLE"],
}) {
  const selectedTypes = Array.isArray(types) && types.length
  ? types.map((type) => String(type).toUpperCase())
  : ["MULTIPLE"];

  const difficultyGuide = {
    easy: `
- 낮음 난이도:
  - 문서에 나온 핵심 용어, 정의, 기본 특징을 묻는다.
  - 복잡한 추론보다 개념 확인 중심으로 출제한다.
  - 문제 문장은 짧고 명확하게 작성한다.
  - 정답은 문서에서 직접 확인 가능한 내용으로 만든다.
`,
    normal: `
- 보통 난이도:
  - 개념 간 차이, 절차, 원인과 결과, 동작 흐름을 묻는다.
  - 단순 정의보다 이해 여부를 확인하는 문제를 만든다.
  - 서로 비슷한 개념을 구분할 수 있는 문제를 포함한다.
  - 문서 내용을 읽고 관계를 파악해야 풀 수 있게 만든다.
`,
    hard: `
- 높음 난이도:
  - 문서 내용을 바탕으로 상황 판단, 적용, 비교 추론 문제를 만든다.
  - 단순 암기보다 어떤 개념을 어떤 상황에 적용해야 하는지 묻는다.
  - 여러 개념을 함께 이해해야 풀 수 있는 문제를 포함한다.
  - 단, 문서에 없는 외부 지식이나 과도한 추측은 사용하지 않는다.
`,
  };

  const typeRules = {
  MULTIPLE: `
MULTIPLE 유형 작성 규칙:
- type이 "MULTIPLE"인 문제는 객관식 문제다.
- options는 반드시 4개 작성한다.
- 인덱스는 0부터 시작한다.
- answerIndexes는 정답 선택지 인덱스 1개만 배열로 작성한다.
- optionExplanations는 options와 같은 순서로 정확히 4개 작성한다.
`,

  OX: `
OX 유형 작성 규칙:
- type이 "OX"인 문제는 O/X 문제다.
- options는 반드시 ["O", "X"]로 작성한다.
- answerIndexes는 [0] 또는 [1]만 작성한다.
- O가 정답이면 [0], X가 정답이면 [1]이다.
- 단순 말장난이 아니라 문서 내용의 참/거짓을 확인하는 문제로 만든다.
- optionExplanations는 ["O 선택지 해설", "X 선택지 해설"] 순서로 정확히 2개 작성한다.
`,

  SHORT: `
SHORT 유형 작성 규칙:
- type이 "SHORT"인 문제는 단답형 문제다.
- options는 반드시 빈 배열 []로 작성한다.
- answerIndexes는 반드시 빈 배열 []로 작성한다.
- answerText에는 반드시 정답 한 단어만 작성한다.
- 정답이 여러 단어로 이루어진 고유 용어라면 단어 사이를 한 칸만 띄운다.
- 문장형 답안, 서술형 답안, 설명형 답안은 절대 만들지 않는다.
- 문제 문장 안에 답안을 어떤 언어로 써야 하는지 반드시 명시한다.
  예: "영어 한 단어로 쓰시오.", "한국어 한 단어로 쓰시오."
- 한국어/영어 표기가 모두 가능한 용어라면 둘 중 하나를 반드시 지정한다.
- answerLanguage에는 "KOREAN" 또는 "ENGLISH"를 작성한다.
- answerFormatHint에는 사용자에게 보여줄 입력 규칙을 작성한다.
- acceptableAnswers에는 문제에서 지정한 언어와 같은 언어의 인정 답안만 넣는다.
- optionExplanations는 반드시 빈 배열 []로 작성한다.
- answerText는 절대 비우지 않는다.
- answerText가 비어 있으면 해당 문제는 만들지 않는다.
`,
};

 const fieldRules = {
  MULTIPLE: `
- MULTIPLE 문제:
  - options는 정확히 4개 작성한다.
  - answerIndexes는 정답 인덱스 배열로 작성한다.
  - answerText, answerLanguage, answerFormatHint는 빈 문자열로 작성한다.
  - acceptableAnswers는 빈 배열로 작성한다.
  - optionExplanations는 정확히 4개 작성한다.
`,

  OX: `
- OX 문제:
  - options는 반드시 ["O", "X"]로 작성한다.
  - answerIndexes는 [0] 또는 [1]만 작성한다.
  - answerText, answerLanguage, answerFormatHint는 빈 문자열로 작성한다.
  - acceptableAnswers는 빈 배열로 작성한다.
  - optionExplanations는 정확히 2개 작성한다.
`,

  SHORT: `
- SHORT 문제:
  - options는 빈 배열 []로 작성한다.
  - answerIndexes는 빈 배열 []로 작성한다.
  - answerText에는 정답 한 단어만 작성한다.
  - answerText는 반드시 비어 있지 않은 정답 한 단어여야 한다.
  - answerText가 비어 있으면 해당 문제는 만들지 않는다.
  - acceptableAnswers에는 같은 언어의 인정 답안만 넣는다.
  - answerLanguage는 "KOREAN" 또는 "ENGLISH"로 작성한다.
  - answerFormatHint에는 사용자 입력 안내를 작성한다.
  - optionExplanations는 빈 배열 []로 작성한다.
`,
};

  const typeGuide = selectedTypes
  .map((type) => typeRules[type])
  .filter(Boolean)
  .join("\n");

  const fieldGuide = selectedTypes
  .map((type) => fieldRules[type])
  .filter(Boolean)
  .join("\n");

  const typeCountGuide = selectedTypes
  .map((type, index) => {
    const baseCount = Math.floor(questionCount / selectedTypes.length);
    const extra = index < questionCount % selectedTypes.length ? 1 : 0;
    return `- ${type}: ${baseCount + extra}문제`;
  })
  .join("\n");

const outputFormat = `
[
  {
    "type": "${selectedTypes.join(" 또는 ")}",
    "question": "문제 내용",
    "options": [],
    "answerIndexes": [],
    "answerText": "",
    "acceptableAnswers": [],
    "answerLanguage": "",
    "answerFormatHint": "",
    "explanation": "짧은 해설",
    "optionExplanations": []
  }
]
`;


  return `
너는 업로드된 PDF 문서만 근거로 시험 대비 퀴즈를 생성하는 시스템이다.

가장 중요한 절대 규칙:
- 이번 퀴즈에서 허용된 문제 유형은 ${selectedTypes.join(", ")} 뿐이다.
- 모든 문제의 type 값은 반드시 ${selectedTypes.join(", ")} 중 하나여야 한다.
- 허용되지 않은 문제 유형은 절대 포함하지 않는다.
- 문제는 정확히 ${questionCount}개 만든다.
- 출력 JSON 배열의 길이는 반드시 ${questionCount}개여야 한다.
- 출력은 반드시 하나의 JSON 배열만 반환한다.
- JSON 앞뒤에 설명, markdown, 코드블록을 붙이지 않는다.

유형별 문제 수:
${typeCountGuide}

문서 근거 규칙:
- 반드시 [문서 chunk] 안의 내용만 사용한다.
- 문서에 없는 상식 문제는 만들지 않는다.
- 단, 문서 텍스트가 부족한 경우 문서 제목, 추출 가능한 문장, 핵심 키워드를 바탕으로 쉬운 개념 확인 문제를 만든다.
- 문서에 전혀 없는 외부 지식은 추가하지 않는다.
- 각 문제에는 반드시 type을 넣는다.

난이도 규칙:
${difficultyGuide[difficulty] || difficultyGuide.normal}

유형별 작성 규칙:
${typeGuide}

공통 출제 목표:
- 핵심 개념, 정의, 차이점, 절차, 원인과 결과, 주의사항 중심으로 문제를 만든다.
- 단순 암기 문제와 이해 확인 문제를 적절히 섞는다.
- 같은 개념을 반복해서 묻지 않는다.
- 문제 문장은 학습자가 바로 이해할 수 있게 자연스럽게 작성한다.
- 정답이 애매하거나 여러 해석이 가능한 문제는 만들지 않는다.

해설 작성 규칙:
- explanation은 반드시 1~2문장으로 작성한다.
- 정답이 왜 맞는지 먼저 설명한다.
- 오답과 비교했을 때 핵심 차이가 무엇인지 설명한다.
- 문서 내용에 근거해서 학습자가 다시 이해할 수 있게 구체적으로 작성한다.
- "문서에 따르면", "자료에서는" 같은 표현을 사용해 문서 근거 문제임을 드러낸다.
- optionExplanations는 문제 유형 규칙에 맞는 개수로 작성한다.
- optionExplanations는 문제 전체 해설 explanation을 그대로 반복하지 않는다.

[문서 제목]
${title}

[문서 chunk]
${context}

출력 필드 규칙:
- type은 반드시 ${selectedTypes.join(", ")} 중 하나만 사용한다.
${fieldGuide}

출력 형식:
${outputFormat}

최종 검토 후 출력:
- 출력 직전에 JSON 배열 길이가 정확히 ${questionCount}개인지 확인한다.
- 출력 직전에 모든 type이 ${selectedTypes.join(", ")} 중 하나인지 확인한다.
- 출력 직전에 아래 유형별 문제 수가 맞는지 확인한다.
${typeCountGuide}
- 조건이 하나라도 맞지 않으면 설명하지 말고 JSON을 고쳐서 최종 JSON 배열만 출력한다.
`;
}
