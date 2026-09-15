/**
 * Server-only Grok Build helper for Code Lens.
 * Never import this module from any client component or browser bundle.
 *
 * Uses the xAI Responses API exactly as specified:
 * - POST https://api.x.ai/v1/responses
 * - Authorization: Bearer ${XAI_API_KEY}
 * - model: "grok-build-0.1"
 * - input: the full prompt string
 * - Extract output_text or output[].content[] (type === "output_text")
 */

export type TaskKey = "explain" | "fix_bugs" | "generate_tests" | "suggest_improvements";

export interface BugFixes {
  summary: string;
  issues: string[];
  fixed_code: string;
}

export interface Tests {
  framework: string;
  code: string;
}

export interface AnalysisResult {
  explanation?: string;
  bug_fixes?: BugFixes;
  tests?: Tests;
  improvements?: string[];
}

export interface ParseErrorResult {
  parseError: true;
  raw: string;
}

export type GrokAnalysis = AnalysisResult | ParseErrorResult;

interface AnalyzeParams {
  code: string;
  language: string;
  filePath?: string;
  tasks: TaskKey[];
}

const TASK_LABEL: Record<TaskKey, string> = {
  explain: "Explain",
  fix_bugs: "Fix Bugs",
  generate_tests: "Generate Tests",
  suggest_improvements: "Suggest Improvements",
};

function buildPrompt({ code, language, filePath, tasks }: AnalyzeParams): string {
  const fileInfo = filePath ? ` from file "${filePath}"` : "";
  const taskList = tasks.map((t) => TASK_LABEL[t]).join(", ");
  const keys = tasks
    .map((t) => {
      if (t === "explain") return '"explanation"';
      if (t === "fix_bugs") return '"bug_fixes"';
      if (t === "generate_tests") return '"tests"';
      return '"improvements"';
    })
    .join(", ");

  const instructions = `
You are an expert senior software engineer performing code review.

Analyze the following ${language} code${fileInfo}.

Requested tasks (perform ONLY these): ${taskList}

Return ONLY a single valid JSON object. 
- No markdown code fences.
- No explanatory prose before or after the JSON.
- Include ONLY the keys for the tasks that were requested: ${keys}
- All code inside JSON strings must be properly escaped.

Exact shape (only include requested keys):
{
  "explanation": "clear plain-English explanation of what the code does",
  "bug_fixes": {
    "summary": "one-sentence description of issues",
    "issues": ["issue 1 explanation", "issue 2 explanation"],
    "fixed_code": "the corrected source (provide full file only for small scripts; for large files give a concise unified diff or the key changed functions only)"
  },
  "tests": {
    "framework": "name of test framework (e.g. jest, vitest, pytest, ...)",
    "code": "complete unit test source code as a string"
  },
  "improvements": ["actionable improvement 1", "actionable improvement 2 with rationale"]
}

CODE TO ANALYZE:
\`\`\`${language}
${code}
\`\`\`

Respond with the JSON now.`.trim();

  return instructions;
}

function extractTextFromResponse(data: any): string {
  // Preferred: some SDKs / wrappers surface output_text
  if (typeof data?.output_text === "string") {
    return data.output_text;
  }

  // Canonical Responses shape
  if (Array.isArray(data?.output)) {
    const pieces: string[] = [];
    for (const item of data.output) {
      if (Array.isArray(item?.content)) {
        for (const c of item.content) {
          if (c?.type === "output_text" && typeof c?.text === "string") {
            pieces.push(c.text);
          }
        }
      }
    }
    if (pieces.length > 0) return pieces.join("\n");
  }

  // Fallbacks seen in some payloads
  if (typeof data?.content === "string") return data.content;
  if (Array.isArray(data?.choices) && data.choices[0]?.message?.content) {
    return data.choices[0].message.content;
  }

  // Last resort: stringify (will likely fail parse later)
  return typeof data === "string" ? data : JSON.stringify(data);
}

function robustParse(raw: string): AnalysisResult | null {
  if (!raw || typeof raw !== "string") return null;

  // 1. Direct parse
  try {
    const p = JSON.parse(raw);
    if (p && typeof p === "object") return p as AnalysisResult;
  } catch {
    /* continue */
  }

  let cleaned = raw.trim();

  // 2. Strip common markdown fences
  cleaned = cleaned
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    const p = JSON.parse(cleaned);
    if (p && typeof p === "object") return p as AnalysisResult;
  } catch {
    /* continue */
  }

  // 3. Extract from first { to last }
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const candidate = cleaned.slice(firstBrace, lastBrace + 1);
    try {
      const p = JSON.parse(candidate);
      if (p && typeof p === "object") return p as AnalysisResult;
    } catch {
      /* fail */
    }
  }

  return null;
}

export async function analyzeWithGrok(params: AnalyzeParams): Promise<GrokAnalysis> {
  const apiKey = process.env.XAI_API_KEY;

  if (!apiKey) {
    // Should never reach here because of startup guard + route guard,
    // but defend anyway.
    throw new Error("XAI_API_KEY is not configured on the server.");
  }

  // === TEST MODE for reliable local demo ===
  if (apiKey === "xai-test-dummy-123") {
    return getTestAnalysis(params);
  }

  const prompt = buildPrompt(params);

  const res = await fetch("https://api.x.ai/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "grok-build-0.1",
      input: prompt,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const safe = text.slice(0, 300).replace(/[\r\n]/g, " ");
    throw new Error(`xAI API error ${res.status}: ${safe}`);
  }

  const data = await res.json().catch(() => ({}));
  const modelText = extractTextFromResponse(data);

  const parsed = robustParse(modelText);

  if (parsed) {
    // Return only the keys the caller asked for (defensive)
    const allowed = new Set<string>();
    for (const t of params.tasks) {
      if (t === "explain") allowed.add("explanation");
      if (t === "fix_bugs") allowed.add("bug_fixes");
      if (t === "generate_tests") allowed.add("tests");
      if (t === "suggest_improvements") allowed.add("improvements");
    }

    const filtered: AnalysisResult = {};
    if (allowed.has("explanation") && typeof parsed.explanation === "string") {
      filtered.explanation = parsed.explanation;
    }
    if (allowed.has("bug_fixes") && parsed.bug_fixes && typeof parsed.bug_fixes === "object") {
      filtered.bug_fixes = parsed.bug_fixes;
    }
    if (allowed.has("tests") && parsed.tests && typeof parsed.tests === "object") {
      filtered.tests = parsed.tests;
    }
    if (
      allowed.has("improvements") &&
      Array.isArray(parsed.improvements)
    ) {
      filtered.improvements = parsed.improvements;
    }
    return filtered;
  }

  // Parsing completely failed — return raw for UI to display safely
  return {
    parseError: true,
    raw: modelText || JSON.stringify(data, null, 2).slice(0, 8000),
  };
}

// === Test data for local verification (no real API call) ===
function getTestAnalysis(params: AnalyzeParams): AnalysisResult {
  const isJS = params.language.includes("javascript") || params.code.includes("function processItems");
  const isPy = params.language.includes("python") || params.code.includes("def average");
  const isTS = params.language.includes("typescript") || params.code.includes("formatDisplayName");

  const result: AnalysisResult = {};

  if (params.tasks.includes("explain")) {
    result.explanation = isJS
      ? "This function iterates over an array of items and attempts to uppercase each one, collecting the results. It has an off-by-one error in the loop condition that will cause it to access an undefined value at the end of the array."
      : isPy
      ? "The function calculates the arithmetic mean of a list of numbers by summing them and dividing by the count. It does not handle the case when the input list is empty, which would cause a division by zero error."
      : "A small utility to format a person's display name from first and optional last name. It trims input and uses the first letter of the last name as an initial. The implementation is correct but could be improved for readability and robustness.";
  }

  if (params.tasks.includes("fix_bugs")) {
    if (isJS) {
      result.bug_fixes = {
        summary: "Off-by-one error in the for loop condition.",
        issues: [
          "The loop uses i <= items.length instead of i < items.length, causing items[items.length] (undefined) to be accessed.",
          "No check if items[i] exists before calling .toUpperCase()."
        ],
        fixed_code: `function processItems(items) {
  const results = [];
  for (let i = 0; i < items.length; i++) {
    if (items[i]) {
      results.push(items[i].toUpperCase());
    }
  }
  return results;
}`
      };
    } else if (isPy) {
      result.bug_fixes = {
        summary: "No handling for empty list (division by zero).",
        issues: [
          "When values is empty, len(values) == 0 and total / 0 raises ZeroDivisionError."
        ],
        fixed_code: `def average(values):
    """Return the average of a list of numbers."""
    if not values:
        return 0.0  # or raise ValueError("Cannot average empty list")
    total = sum(values)
    return total / len(values)`
      };
    } else {
      result.bug_fixes = {
        summary: "Minor robustness issues.",
        issues: ["last[0] can fail if last is empty string (though optional)."],
        fixed_code: `export function formatDisplayName(first: string, last?: string): string {
  const trimmedFirst = first.trim();
  if (!last) {
    return trimmedFirst;
  }
  const initial = last.trim()[0]?.toUpperCase() ?? "";
  return initial ? \`\${trimmedFirst} \${initial}.\` : trimmedFirst;
}`
      };
    }
  }

  if (params.tasks.includes("generate_tests")) {
    if (isJS || isTS) {
      result.tests = {
        framework: "jest",
        code: `import { ${isTS ? "formatDisplayName" : "processItems"} } from "./${isTS ? "format" : "sum"}";

describe("${isTS ? "formatDisplayName" : "processItems"}", () => {
  it("handles basic case", () => {
    ${isTS 
      ? 'expect(formatDisplayName("John", "Doe")).toBe("John D.");' 
      : 'expect(processItems(["apple", "banana"])).toEqual(["APPLE", "BANANA"]);'}
  });

  it("handles edge cases", () => {
    ${isTS 
      ? 'expect(formatDisplayName("  Alice  ")).toBe("Alice");' 
      : 'expect(processItems([])).toEqual([]);'}
  });
});`
      };
    } else {
      result.tests = {
        framework: "pytest",
        code: `import pytest
from stats import average

def test_average_basic():
    assert average([10, 20, 30]) == 20.0

def test_average_empty():
    assert average([]) == 0.0  # or test raises`
      };
    }
  }

  if (params.tasks.includes("suggest_improvements")) {
    result.improvements = [
      "Add input validation and JSDoc / docstring.",
      "Consider using Array.prototype.map + filter for the JS version instead of manual loop.",
      "Add unit tests (see Generate Tests).",
      "Use more descriptive variable names.",
      "For TS, make the function more robust against whitespace-only strings."
    ];
  }

  return result;
}
