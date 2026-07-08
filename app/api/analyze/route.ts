import { NextRequest, NextResponse } from "next/server";
import {
  analyzeWithGrok,
  type TaskKey,
} from "../../../lib/grok";

export const runtime = "nodejs"; // ensure server runtime (not edge)

const ALLOWED_TASKS: TaskKey[] = [
  "explain",
  "fix_bugs",
  "generate_tests",
  "suggest_improvements",
];

interface AnalyzeRequestBody {
  code?: string;
  language?: string;
  filePath?: string;
  tasks?: string[];
}

function isTaskKey(t: string): t is TaskKey {
  return (ALLOWED_TASKS as string[]).includes(t);
}

export async function POST(request: NextRequest) {
  // Key guard — refuse without attempting the upstream call
  if (!process.env.XAI_API_KEY) {
    return NextResponse.json(
      {
        error:
          "XAI_API_KEY is not set on the server. Export it and restart: export XAI_API_KEY=\"xai-...\" (get one at https://console.x.ai)",
      },
      { status: 500 }
    );
  }

  let body: AnalyzeRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const code = (body.code || "").toString();
  const language = (body.language || "text").toString();
  const filePath = body.filePath ? body.filePath.toString() : undefined;
  const incomingTasks = Array.isArray(body.tasks) ? body.tasks : [];

  if (!code.trim()) {
    return NextResponse.json({ error: "code is required" }, { status: 400 });
  }

  const tasks: TaskKey[] = incomingTasks.filter(isTaskKey);

  if (tasks.length === 0) {
    return NextResponse.json({ error: "At least one valid task is required" }, { status: 400 });
  }

  try {
    const result = await analyzeWithGrok({
      code,
      language,
      filePath,
      tasks,
    });

    return NextResponse.json(result);
  } catch (err: any) {
    const message = err?.message || "Analysis failed";
    // Never leak secrets
    const safeMessage = String(message).replace(/xai-[A-Za-z0-9_-]+/g, "xai-***");
    return NextResponse.json(
      { error: safeMessage },
      { status: 502 }
    );
  }
}
