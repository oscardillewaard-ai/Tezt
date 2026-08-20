interface OnboardingModalProps {
  onDismiss: () => void
}

export function OnboardingModal({ onDismiss }: OnboardingModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
    >
      <div className="max-w-lg rounded-2xl border border-[var(--border)] bg-[var(--bg)] p-6 shadow-xl">
        <h2 id="onboarding-title" className="text-xl font-semibold text-[var(--text)]">
          Welkom bij Bergtrainer
        </h2>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Deze app rekent uit hoeveel keer je een training op moet om dezelfde hoogtemeters te
          trainen als je wedstrijd — en verdeelt dat over de juiste steilheid als je op een
          pendelheuvel traint. Drie stappen:
        </p>

        <ol className="mt-4 space-y-3 text-sm">
          <li className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-orange-400 text-xs font-semibold text-slate-900">
              1
            </span>
            <span className="text-[var(--text-2)]">
              Kies je <strong>wedstrijd</strong> — upload een GPX, of kies een voorbeeldwedstrijd
              als je die nog niet hebt.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-400 text-xs font-semibold text-slate-900">
              2
            </span>
            <span className="text-[var(--text-2)]">
              Kies je <strong>trainingsberg</strong> — de vaste heuvel met flanken, of je eigen
              GPX van één beklimming.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--surface-2-active)] text-xs font-semibold text-[var(--text)]">
              3
            </span>
            <span className="text-[var(--text-2)]">
              Bekijk je <strong>trainingsplan</strong>: hoeveel herhalingen, en optioneel een
              opbouwschema tot wedstrijddag.
            </span>
          </li>
        </ol>

        <p className="mt-4 text-xs text-[var(--faint)]">
          Begin eenvoudig — schakel naar "Uitgebreid" (rechtsboven) voor fijnere controle over
          start-percentage en trainingen per week.
        </p>

        <button
          type="button"
          onClick={onDismiss}
          className="mt-6 w-full rounded-lg bg-orange-400 px-4 py-2.5 text-sm font-semibold text-slate-900 hover:bg-orange-300"
        >
          Aan de slag
        </button>
      </div>
    </div>
  )
}
