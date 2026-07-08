"use client";

import React, { useState, useRef, useCallback } from "react";
import {
  Upload,
  FileText,
  Folder,
  Play,
  Copy,
  X,
  AlertTriangle,
  Check,
} from "lucide-react";
import { Prism as SyntaxHighlighter, themes } from "prism-react-renderer";

// Types
interface UploadedFile {
  path: string;
  name: string;
  content: string;
  language: string;
  size: number;
}

type TaskId = "explain" | "fix_bugs" | "generate_tests" | "suggest_improvements";

interface BugFixes {
  summary: string;
  issues: string[];
  fixed_code: string;
}

interface TestsBlock {
  framework: string;
  code: string;
}

interface AnalysisResult {
  explanation?: string;
  bug_fixes?: BugFixes;
  tests?: TestsBlock;
  improvements?: string[];
}

interface ParseError {
  parseError: true;
  raw: string;
}

type Analysis = AnalysisResult | ParseError | null;

// Samples (different languages, exercise different tasks)
const SAMPLES: Record<string, { name: string; path: string; content: string; language: string }> = {
  js: {
    name: "sum.js",
    path: "utils/sum.js",
    language: "javascript",
    content: `function processItems(items) {
  const results = [];
  for (let i = 0; i <= items.length; i++) {
    // Off-by-one: will read undefined at the end
    if (items[i]) {
      results.push(items[i].toUpperCase());
    }
  }
  return results;
}

// Example usage
console.log(processItems(["apple", "banana"]));`,
  },
  py: {
    name: "stats.py",
    path: "analytics/stats.py",
    language: "python",
    content: `def average(values):
    """Return the average of a list of numbers."""
    # Does not handle the empty list edge case
    total = sum(values)
    return total / len(values)


def main():
    data = [10, 20, 30]
    print("avg:", average(data))
    print("empty avg:", average([]))


if __name__ == "__main__":
    main()`,
  },
  ts: {
    name: "format.ts",
    path: "utils/format.ts",
    language: "typescript",
    content: `export function formatDisplayName(first: string, last?: string): string {
  if (!last) {
    return first.trim();
  }
  // Works but could be cleaner + missing unit tests
  const initial = last[0]?.toUpperCase() ?? "";
  return \`\${first.trim()} \${initial}.\`;
}

export function slugify(input: string): string {
  return input.toLowerCase().replace(/\\s+/g, "-");
}`,
  },
};

const TASKS: { id: TaskId; label: string }[] = [
  { id: "explain", label: "Explain" },
  { id: "fix_bugs", label: "Fix Bugs" },
  { id: "generate_tests", label: "Generate Tests" },
  { id: "suggest_improvements", label: "Suggest Improvements" },
];

const TEXT_EXTENSIONS = new Set([
  "js", "jsx", "mjs", "cjs",
  "ts", "tsx",
  "py", "go", "rs", "java", "c", "h", "cpp", "cc", "hpp",
  "cs", "rb", "php", "swift", "kt", "scala",
  "sh", "bash", "zsh", "fish",
  "json", "md", "markdown", "txt", "yml", "yaml", "toml", "ini",
  "css", "scss", "sass", "less",
  "html", "htm", "xml", "svg",
  "dockerfile", "makefile", "gitignore", "env",
]);

const BINARY_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "ico", "bmp",
  "pdf", "zip", "tar", "gz", "7z", "rar",
  "exe", "dll", "so", "dylib", "bin", "wasm",
  "mp3", "mp4", "mov", "avi", "webm",
]);

const MAX_FILE_BYTES = 150 * 1024; // 150 KB
const MAX_TOTAL_BYTES = 1024 * 1024; // 1 MB

function detectLanguage(filename: string): string {
  const ext = (filename.split(".").pop() || "").toLowerCase();
  if (!ext) return "text";
  const map: Record<string, string> = {
    js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
    ts: "typescript", tsx: "typescript",
    py: "python",
    go: "go",
    rs: "rust",
    java: "java",
    c: "c", h: "c",
    cpp: "cpp", cc: "cpp", hpp: "cpp",
    cs: "csharp",
    rb: "ruby",
    php: "php",
    json: "json",
    md: "markdown", markdown: "markdown",
    yml: "yaml", yaml: "yaml",
    html: "html", htm: "html",
    css: "css", scss: "scss",
    sh: "bash", bash: "bash", zsh: "bash",
  };
  return map[ext] || "text";
}

function isLikelyTextFile(file: File): boolean {
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  if (BINARY_EXTENSIONS.has(ext)) return false;
  if (TEXT_EXTENSIONS.has(ext)) return true;
  // Heuristic fallback for unknown small text-ish files
  return file.size < 80000;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

// Build a simple nested tree for display
type TreeNode = {
  name: string;
  path: string;
  type: "file" | "dir";
  children?: TreeNode[];
  file?: UploadedFile;
};

function buildTree(files: UploadedFile[]): TreeNode[] {
  const root: TreeNode = { name: "", path: "", type: "dir", children: [] };

  for (const f of files) {
    const parts = f.path.split("/");
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;

      if (!current.children) current.children = [];

      let child = current.children.find((c) => c.name === part);

      if (!child) {
        child = {
          name: part,
          path: parts.slice(0, i + 1).join("/"),
          type: isLast ? "file" : "dir",
        };
        if (isLast) child.file = f;
        current.children.push(child);
      }
      current = child;
    }
  }

  // Sort: dirs first, then files
  const sortNodes = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    nodes.forEach((n) => n.children && sortNodes(n.children));
  };
  sortNodes(root.children || []);
  return root.children || [];
}

function renderTree(
  nodes: TreeNode[],
  selectedPath: string | null,
  onSelect: (path: string | null) => void,
  level = 0
): React.ReactNode {
  return nodes.map((node) => {
    const isSelected = node.path === selectedPath;
    const indent = level * 14;

    if (node.type === "dir") {
      return (
        <div key={node.path}>
          <div
            className="file-item"
            style={{ paddingLeft: 8 + indent }}
            onClick={() => onSelect(node.path)} // selecting a dir just highlights (no content)
          >
            <Folder size={14} className="icon" />
            <span>{node.name}/</span>
          </div>
          {node.children && renderTree(node.children, selectedPath, onSelect, level + 1)}
        </div>
      );
    }

    return (
      <div
        key={node.path}
        className={`file-item ${isSelected ? "active" : ""}`}
        style={{ paddingLeft: 8 + indent }}
        onClick={() => onSelect(node.path)}
      >
        <FileText size={14} className="icon" />
        <span className="truncate">{node.name}</span>
        <span className="ml-auto text-[10px] opacity-50">
          {node.file ? formatBytes(node.file.size) : ""}
        </span>
      </div>
    );
  });
}

// Robust folder + file collection from drag
async function collectFilesFromDataTransfer(dt: DataTransfer): Promise<File[]> {
  const files: File[] = [];
  const items = dt.items;

  if (!items || items.length === 0) {
    // Fallback
    return Array.from(dt.files);
  }

  const promises: Promise<void>[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind !== "file") continue;

    const entry = item.webkitGetAsEntry?.();
    if (entry) {
      promises.push(traverseEntry(entry, "", files));
    } else if (item.getAsFile()) {
      const f = item.getAsFile();
      if (f) files.push(f);
    }
  }

  await Promise.all(promises);
  return files;
}

function traverseEntry(entry: any, path: string, outFiles: File[]): Promise<void> {
  return new Promise((resolve) => {
    if (entry.isFile) {
      entry.file((file: File) => {
        // Preserve relative path when possible
        const relPath = path ? `${path}/${file.name}` : file.name;
        // Attach synthetic property for later use
        (file as any).webkitRelativePath = relPath;
        outFiles.push(file);
        resolve();
      });
    } else if (entry.isDirectory) {
      const dirReader = entry.createReader();
      dirReader.readEntries(async (entries: any[]) => {
        const subPromises = entries.map((e) =>
          traverseEntry(e, path ? `${path}/${entry.name}` : entry.name, outFiles)
        );
        await Promise.all(subPromises);
        resolve();
      });
    } else {
      resolve();
    }
  });
}

export default function CodeLens() {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [enabledTasks, setEnabledTasks] = useState<Record<TaskId, boolean>>({
    explain: true,
    fix_bugs: true,
    generate_tests: true,
    suggest_improvements: true,
  });
  const [analysis, setAnalysis] = useState<Analysis>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skipMessages, setSkipMessages] = useState<string[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const selectedFile = files.find((f) => f.path === selectedPath) || null;

  const tree = buildTree(files);

  // Total size for caps
  const totalSize = files.reduce((sum, f) => sum + f.size, 0);

  // Toggle task
  const toggleTask = (id: TaskId) => {
    setEnabledTasks((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  // Select file (or null for "whole codebase")
  const selectPath = (path: string | null) => {
    setSelectedPath(path);
    // Keep previous analysis (user can re-analyze for new selection)
  };

  // Load a built-in sample (replaces current files)
  const loadSample = (key: keyof typeof SAMPLES) => {
    const s = SAMPLES[key];
    const uf: UploadedFile = {
      path: s.path,
      name: s.name,
      content: s.content,
      language: s.language,
      size: new Blob([s.content]).size,
    };
    setFiles([uf]);
    setSelectedPath(s.path);
    setAnalysis(null);
    setError(null);
    setSkipMessages([]);
  };

  // Read a single File object safely
  const readFileAsText = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = reject;
      reader.readAsText(file);
    });
  };

  // Process dropped / picked files
  const processFiles = async (rawFiles: File[]) => {
    const newFiles: UploadedFile[] = [];
    const skips: string[] = [];
    let runningTotal = totalSize;

    for (const raw of rawFiles) {
      const relPath = (raw as any).webkitRelativePath || raw.name;
      const ext = (relPath.split(".").pop() || "").toLowerCase();

      if (!isLikelyTextFile(raw)) {
        skips.push(`${relPath} (binary or unsupported)`);
        continue;
      }
      if (raw.size > MAX_FILE_BYTES) {
        skips.push(`${relPath} (too large: ${formatBytes(raw.size)})`);
        continue;
      }
      if (runningTotal + raw.size > MAX_TOTAL_BYTES) {
        skips.push(`${relPath} (would exceed total size limit)`);
        continue;
      }

      try {
        const content = await readFileAsText(raw);
        // Quick binary guard after read
        if (content.includes("\u0000")) {
          skips.push(`${relPath} (appears binary)`);
          continue;
        }

        const language = detectLanguage(relPath);
        const uf: UploadedFile = {
          path: relPath,
          name: raw.name,
          content,
          language,
          size: raw.size,
        };
        newFiles.push(uf);
        runningTotal += raw.size;
      } catch (e) {
        skips.push(`${relPath} (read error)`);
      }
    }

    if (newFiles.length === 0 && skips.length === 0) {
      setError("No usable text/source files were found.");
      return;
    }

    // Merge (dedupe by path)
    const existingPaths = new Set(files.map((f) => f.path));
    const merged = [...files];

    for (const nf of newFiles) {
      if (!existingPaths.has(nf.path)) {
        merged.push(nf);
      }
    }

    setFiles(merged);
    if (!selectedPath && merged.length > 0) {
      setSelectedPath(merged[0].path);
    }
    setSkipMessages(skips);
    setAnalysis(null);
    setError(null);
  };

  // Drag & drop handlers
  const [isDragging, setIsDragging] = useState(false);

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    try {
      const collected = await collectFilesFromDataTransfer(e.dataTransfer);
      if (collected.length > 0) {
        await processFiles(collected);
      }
    } catch {
      // Fallback to simple files
      await processFiles(Array.from(e.dataTransfer.files));
    }
  };

  // File + folder picker
  const openFilePicker = () => fileInputRef.current?.click();
  const openFolderPicker = () => folderInputRef.current?.click();

  const onFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      await processFiles(Array.from(e.target.files));
    }
    e.target.value = ""; // reset
  };

  const onFolderInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      // webkitRelativePath is populated automatically
      await processFiles(Array.from(e.target.files));
    }
    e.target.value = "";
  };

  // Remove a file
  const removeFile = (path: string) => {
    const remaining = files.filter((f) => f.path !== path);
    setFiles(remaining);
    if (selectedPath === path) {
      setSelectedPath(remaining.length > 0 ? remaining[0].path : null);
    }
    setAnalysis(null);
  };

  const clearAll = () => {
    setFiles([]);
    setSelectedPath(null);
    setAnalysis(null);
    setError(null);
    setSkipMessages([]);
  };

  // Build payload for analysis
  function getAnalysisPayload() {
    const active = (Object.keys(enabledTasks) as TaskId[]).filter((k) => enabledTasks[k]);

    if (selectedFile) {
      return {
        code: selectedFile.content,
        language: selectedFile.language,
        filePath: selectedFile.path,
        tasks: active,
      };
    }

    // Whole codebase
    if (files.length === 0) return null;

    const combined = files
      .map((f) => `// === FILE: ${f.path} ===\n${f.content}`)
      .join("\n\n");

    // Use most common language or text
    const langs = files.map((f) => f.language);
    const primary = langs.sort((a, b) =>
      langs.filter((v) => v === a).length - langs.filter((v) => v === b).length
    ).pop() || "text";

    return {
      code: combined,
      language: primary,
      filePath: undefined,
      tasks: active,
    };
  }

  // Run analysis (real grok-build call)
  const runAnalysis = async () => {
    const payload = getAnalysisPayload();
    const activeTasks = (Object.keys(enabledTasks) as TaskId[]).filter((k) => enabledTasks[k]);

    if (!payload || activeTasks.length === 0) {
      setError("Select at least one task and provide code (or load a sample).");
      return;
    }

    setIsAnalyzing(true);
    setError(null);
    setAnalysis(null);

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data?.error || `Request failed (${res.status})`);
        return;
      }

      if (data.parseError) {
        setAnalysis({ parseError: true, raw: data.raw } as ParseError);
      } else {
        setAnalysis(data as AnalysisResult);
      }
    } catch (e: any) {
      setError(e?.message || "Network error calling analysis API");
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Copy helpers
  const copyToClipboard = async (text: string, label = "Copied") => {
    try {
      await navigator.clipboard.writeText(text);
      // Cheap visual feedback
      const orig = document.title;
      document.title = label;
      setTimeout(() => {
        document.title = orig;
      }, 900);
    } catch {
      // fallback
      alert(text.slice(0, 200) + (text.length > 200 ? "..." : ""));
    }
  };

  const copyRaw = () => {
    if (analysis && "parseError" in analysis) {
      copyToClipboard(analysis.raw, "Raw output copied");
    }
  };

  // Render a highlighted code block with copy
  const CodeBlock = ({ code, lang }: { code: string; lang: string }) => {
    const prismLang = lang === "text" ? "text" : lang;

    return (
      <div className="hl-wrapper">
        <button
          className="copy-btn"
          onClick={() => copyToClipboard(code, "Code copied")}
        >
          <Copy size={13} /> Copy
        </button>
        {/* @ts-expect-error - prism-react-renderer types are loose with React 19 + Next 16 */}
        <SyntaxHighlighter
          language={prismLang}
          style={themes.vsDark}
          customStyle={{
            margin: 0,
            padding: "14px 14px 14px 14px",
            background: "transparent",
            fontSize: "12.5px",
          }}
          codeTagProps={{ style: { fontFamily: "var(--font-geist-mono)" } }}
        >
          {code}
        </SyntaxHighlighter>
      </div>
    );
  };

  const activeTaskCount = Object.values(enabledTasks).filter(Boolean).length;
  const canAnalyze = files.length > 0 && activeTaskCount > 0 && !isAnalyzing;

  // Current viewer language for badge
  const viewerLang = selectedFile?.language || "text";

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-200">
      {/* Header */}
      <header className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur sticky top-0 z-50">
        <div className="max-w-[1280px] mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded bg-indigo-600 flex items-center justify-center">
                <span className="font-bold text-sm tracking-[-1px]">CL</span>
              </div>
              <div>
                <div className="font-semibold tracking-tight text-xl">Code Lens</div>
                <div className="text-[10px] text-zinc-500 -mt-1">powered by grok-build-0.1</div>
              </div>
            </div>
            <div className="badge ml-2">LOCAL DEMO</div>
          </div>

          <div className="flex items-center gap-3 text-sm">
            <a
              href="https://console.x.ai"
              target="_blank"
              className="text-zinc-400 hover:text-zinc-200 underline-offset-4 hover:underline"
            >
              Get API key
            </a>
            <button
              onClick={clearAll}
              className="text-xs px-3 py-1.5 rounded border border-zinc-700 hover:bg-zinc-900"
            >
              Clear workspace
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-[1280px] mx-auto px-6 pt-6 pb-12">
        {/* Samples — instant demo */}
        <div className="mb-4">
          <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-zinc-500 mb-2">
            INSTANT DEMO — CLICK ANY
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => loadSample("js")} className="sample-btn">
              JS • off-by-one loop
            </button>
            <button onClick={() => loadSample("py")} className="sample-btn">
              Python • empty list
            </button>
            <button onClick={() => loadSample("ts")} className="sample-btn">
              TypeScript • refactorable util
            </button>
            <div className="text-xs self-center text-zinc-500 ml-2">
              Loads a real snippet. Then click <span className="font-medium text-zinc-400">Analyze</span>.
            </div>
          </div>
        </div>

        {/* Drop zone */}
        <div
          className={`drop-zone rounded-2xl p-8 mb-4 text-center ${isDragging ? "dragover" : ""}`}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          <div className="flex flex-col items-center gap-3">
            <Upload size={28} className="text-indigo-400" />
            <div>
              <div className="font-medium">Drop a folder or file here</div>
              <div className="text-sm text-zinc-400">Supports folders (webkitdirectory) • multi-file • text &amp; source only</div>
            </div>
            <div className="flex gap-2 mt-1">
              <button
                onClick={openFilePicker}
                className="px-4 py-1.5 text-sm rounded-lg border border-zinc-700 hover:bg-zinc-900 flex items-center gap-2"
              >
                <FileText size={15} /> Choose files
              </button>
              <button
                onClick={openFolderPicker}
                className="px-4 py-1.5 text-sm rounded-lg border border-zinc-700 hover:bg-zinc-900 flex items-center gap-2"
              >
                <Folder size={15} /> Choose folder
              </button>
            </div>
            <div className="text-[11px] text-zinc-500 mt-1">
              Max {formatBytes(MAX_FILE_BYTES)} per file • {formatBytes(MAX_TOTAL_BYTES)} total • binaries skipped
            </div>
          </div>

          {/* Hidden inputs */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={onFileInputChange}
          />
          <input
            ref={folderInputRef}
            type="file"
            // @ts-expect-error webkitdirectory
            webkitdirectory=""
            directory=""
            multiple
            className="hidden"
            onChange={onFolderInputChange}
          />
        </div>

        {/* Skip / info banner */}
        {skipMessages.length > 0 && (
          <div className="mb-4 text-xs bg-zinc-900 border border-zinc-800 p-3 rounded-lg text-amber-400 flex gap-2">
            <AlertTriangle size={15} className="mt-px" />
            <div>Skipped: {skipMessages.join(" • ")}</div>
          </div>
        )}

        {/* Main 3-pane */}
        <div className="code-lens-main">
          {/* LEFT: File tree / list */}
          <div className="flex flex-col min-h-[380px]">
            <div className="flex items-center justify-between mb-1.5 px-1">
              <div className="text-sm font-medium text-zinc-300">
                Files <span className="text-zinc-500">({files.length})</span>
              </div>
              {files.length > 0 && (
                <button onClick={clearAll} className="text-xs text-zinc-500 hover:text-zinc-300">clear</button>
              )}
            </div>

            <div className="file-tree flex-1 rounded-xl overflow-auto p-1">
              {files.length === 0 ? (
                <div className="empty-state p-4 text-center">
                  No files yet.<br />Drop something or load a sample above.
                </div>
              ) : (
                <>
                  {/* Special "whole codebase" entry */}
                  <div
                    className={`file-item ${selectedPath === null ? "active" : ""}`}
                    onClick={() => selectPath(null)}
                  >
                    <Folder size={14} className="icon" />
                    <span className="font-medium">All files (analyze codebase)</span>
                  </div>
                  {renderTree(tree, selectedPath, selectPath)}
                </>
              )}
            </div>

            {files.length > 0 && (
              <div className="text-[10px] text-zinc-500 mt-1.5 px-1">
                {formatBytes(totalSize)} total • click a file to view &amp; analyze it individually
              </div>
            )}
          </div>

          {/* CENTER: Code viewer */}
          <div className="flex flex-col min-h-[380px]">
            <div className="flex items-center justify-between mb-1.5 px-1">
              <div className="text-sm font-medium text-zinc-300 flex items-center gap-2">
                {selectedFile ? (
                  <>
                    {selectedFile.path}
                    <span className="badge">{viewerLang}</span>
                    <span className="text-zinc-500 text-xs">{formatBytes(selectedFile.size)}</span>
                  </>
                ) : selectedPath === null && files.length > 0 ? (
                  "Codebase (combined for analysis)"
                ) : (
                  "Code viewer"
                )}
              </div>
              {selectedFile && (
                <button
                  onClick={() => removeFile(selectedFile.path)}
                  className="text-zinc-500 hover:text-red-400"
                  title="Remove file"
                >
                  <X size={15} />
                </button>
              )}
            </div>

            <div className="code-viewer flex-1 rounded-xl overflow-hidden border border-zinc-800">
              {selectedFile ? (
                <pre className="p-4 text-[13px] overflow-auto whitespace-pre font-mono leading-relaxed">
                  {selectedFile.content}
                </pre>
              ) : selectedPath === null && files.length > 0 ? (
                <div className="p-4 text-sm text-zinc-400">
                  Whole codebase mode.<br />
                  {files.length} file{files.length === 1 ? "" : "s"} will be sent together when you Analyze.
                </div>
              ) : (
                <div className="empty-state h-full flex items-center justify-center p-8 text-center">
                  Select a file from the list, or load one of the samples above to see code here.
                </div>
              )}
            </div>
          </div>

          {/* RIGHT: Controls + Results */}
          <div className="flex flex-col min-h-[380px]">
            {/* Task toggles */}
            <div className="mb-2 px-1">
              <div className="text-sm font-medium text-zinc-300 mb-1.5">Tasks</div>
              <div className="flex flex-wrap gap-1.5">
                {TASKS.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => toggleTask(t.id)}
                    className={`task-chip ${enabledTasks[t.id] ? "active" : ""}`}
                  >
                    {enabledTasks[t.id] ? <Check size={14} /> : null}
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Analyze button */}
            <button
              onClick={runAnalysis}
              disabled={!canAnalyze}
              className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-60 mb-3"
            >
              <Play size={16} />
              {isAnalyzing ? "Analyzing with grok-build-0.1..." : "Analyze"}
            </button>

            {isAnalyzing && (
              <div className="mb-3">
                <div className="loading-bar rounded" />
                <div className="text-xs text-center text-zinc-500 mt-1">Calling real API — results will appear below</div>
              </div>
            )}

            {/* Results area */}
            <div className="flex-1 overflow-auto">
              {error && (
                <div className="error-box mb-3">
                  {error}
                </div>
              )}

              {!analysis && !isAnalyzing && !error && (
                <div className="empty-state border border-zinc-800 rounded-xl p-4 text-sm">
                  Choose tasks and press Analyze.<br />
                  Results from grok-build will appear here with syntax highlighting.
                </div>
              )}

              {analysis && "parseError" in analysis && (
                <div className="result-panel">
                  <header>Parse Error — raw model output</header>
                  <div className="result-body">
                    <p className="mb-2 text-amber-400 text-xs">The model did not return clean JSON. Here is the raw text:</p>
                    <div className="hl-wrapper">
                      <button className="copy-btn" onClick={copyRaw}>
                        <Copy size={13} /> Copy raw output
                      </button>
                      <pre className="p-3 text-xs overflow-auto whitespace-pre-wrap text-rose-300">{analysis.raw}</pre>
                    </div>
                  </div>
                </div>
              )}

              {analysis && !("parseError" in analysis) && (
                <>
                  {analysis.explanation && (
                    <div className="result-panel">
                      <header>Explain</header>
                      <div className="result-body whitespace-pre-wrap text-sm">
                        {analysis.explanation}
                      </div>
                    </div>
                  )}

                  {analysis.bug_fixes && (
                    <div className="result-panel">
                      <header>Fix Bugs</header>
                      <div className="result-body text-sm">
                        <div className="mb-2 font-medium text-rose-400">{analysis.bug_fixes.summary}</div>
                        {analysis.bug_fixes.issues?.length > 0 && (
                          <ul className="list-disc pl-4 mb-3 space-y-0.5 text-zinc-300">
                            {analysis.bug_fixes.issues.map((issue, i) => (
                              <li key={i}>{issue}</li>
                            ))}
                          </ul>
                        )}
                        {analysis.bug_fixes.fixed_code && (
                          <div>
                            <div className="text-xs mb-1 text-zinc-400">Fixed code</div>
                            <CodeBlock code={analysis.bug_fixes.fixed_code} lang={viewerLang} />
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {analysis.tests && (
                    <div className="result-panel">
                      <header>Generate Tests — {analysis.tests.framework}</header>
                      <div className="result-body">
                        <CodeBlock code={analysis.tests.code} lang={viewerLang} />
                      </div>
                    </div>
                  )}

                  {analysis.improvements && analysis.improvements.length > 0 && (
                    <div className="result-panel">
                      <header>Suggest Improvements</header>
                      <div className="result-body">
                        <ul className="space-y-1.5 text-sm">
                          {analysis.improvements.map((imp, i) => (
                            <li key={i} className="flex gap-2">
                              <span className="text-emerald-400 mt-px">→</span> {imp}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}

                  {Object.keys(analysis).length === 0 && (
                    <div className="text-xs text-amber-400">Model returned an empty result for the requested tasks.</div>
                  )}
                </>
              )}
            </div>

            {/* Footer hint */}
            <div className="text-[10px] text-zinc-500 mt-3 px-1">
              All analysis uses real <span className="font-mono">grok-build-0.1</span> via server route. Files stay in your browser.
            </div>
          </div>
        </div>
      </div>

      <footer className="text-center text-[10px] text-zinc-500 pb-8">
        Code Lens • Local demo • Requires <code>XAI_API_KEY</code> • Never stores your code
      </footer>
    </div>
  );
}
