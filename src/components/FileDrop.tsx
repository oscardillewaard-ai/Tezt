import { useRef, useState, type DragEvent } from 'react'

interface FileDropProps {
  label: string
  hint: string
  onFile: (text: string, filename: string) => void
  accentClass: string
}

export function FileDrop({ label, hint, onFile, accentClass }: FileDropProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [isOver, setIsOver] = useState(false)

  async function handleFiles(files: FileList | null) {
    const file = files?.[0]
    if (!file) return
    const text = await file.text()
    onFile(text, file.name)
  }

  return (
    <div
      onDragOver={(e: DragEvent) => {
        e.preventDefault()
        setIsOver(true)
      }}
      onDragLeave={() => setIsOver(false)}
      onDrop={(e: DragEvent) => {
        e.preventDefault()
        setIsOver(false)
        void handleFiles(e.dataTransfer.files)
      }}
      onClick={() => inputRef.current?.click()}
      className={`cursor-pointer rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
        isOver ? accentClass : 'border-slate-700 hover:border-slate-500'
      }`}
    >
      <p className="font-medium text-slate-200">{label}</p>
      <p className="mt-1 text-sm text-slate-400">{hint}</p>
      <input
        ref={inputRef}
        type="file"
        accept=".gpx"
        className="hidden"
        onChange={(e) => void handleFiles(e.target.files)}
      />
    </div>
  )
}
