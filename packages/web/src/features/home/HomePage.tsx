import { Github, LockKeyhole, Radar, ShieldCheck } from "lucide-react";
import { RepoSubmitForm } from "../../components/RepoSubmitForm";

const ZAI_HF_AVATAR = "https://huggingface.co/api/avatars/zai-org";

const trustSignals = [
  {
    icon: Radar,
    label: "AI-powered analysis",
    detail: "Continuous security research",
  },
  {
    icon: LockKeyhole,
    label: "Private by default",
    detail: "Findings stay encrypted",
  },
  {
    icon: ShieldCheck,
    label: "Maintainer first",
    detail: "Responsible disclosure",
  },
];

export function HomePage() {
  return (
    <main className="openvuln-home relative isolate flex min-h-screen overflow-hidden bg-black text-white">
      <div className="openvuln-glow pointer-events-none absolute inset-0 -z-10" />

      <header className="absolute inset-x-0 top-0 z-10 flex items-center justify-end px-5 py-5 sm:px-8 sm:py-7">
        <a
          href="https://github.com/Clouditera/OpenVuln"
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-9 items-center gap-2 rounded-full border border-[#333] bg-[#030303] px-3.5 text-xs font-medium text-[#acacb0] transition hover:border-[#484a58] hover:bg-[#111216] hover:text-white focus-ring-dark"
        >
          <Github size={14} />
          GitHub
        </a>
      </header>

      <section className="mx-auto flex w-full max-w-5xl flex-col items-center px-5 pb-12 pt-28 text-center sm:px-8 sm:pb-16 sm:pt-32">
        <div className="flex flex-1 flex-col items-center justify-center py-10 sm:py-14">
          <div className="openvuln-brand flex items-center justify-center gap-4 sm:gap-5">
            <div className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/15 bg-white text-2xl font-bold text-black shadow-[0_14px_44px_rgba(0,0,0,0.4)] sm:h-16 sm:w-16">
              <span aria-hidden>Z</span>
              <img
                src={ZAI_HF_AVATAR}
                alt="Z.ai"
                className="absolute inset-0 h-full w-full object-cover"
                onError={(event) => {
                  event.currentTarget.style.display = "none";
                }}
              />
            </div>
            <h1 className="openvuln-title text-[40px] font-[450] leading-[58px] tracking-normal sm:text-[64px] sm:leading-[74px]">
              OpenVuln
            </h1>
          </div>

          <p className="mt-7 max-w-2xl text-balance text-base leading-7 text-[#acacb0] sm:mt-8 sm:text-lg">
            AI-powered vulnerability discovery for the open-source world.
          </p>

          <RepoSubmitForm
            size="hero"
            appearance="dark"
            className="mt-9 w-full max-w-2xl sm:mt-11"
          />
        </div>

        <div className="grid w-full max-w-3xl grid-cols-1 gap-2.5 sm:grid-cols-3 sm:gap-3">
          {trustSignals.map(({ icon: Icon, label, detail }) => (
            <div
              key={label}
              className="flex items-center gap-3 rounded-2xl border border-[#24252a] bg-[#151619] px-4 py-3.5 text-left transition hover:border-[#383a43] hover:bg-[#191a1f]"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-[#292a30] bg-[#1d1e23] text-[#aeb0ba]">
                <Icon size={16} strokeWidth={1.8} />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-[#f0f2f6]">{label}</p>
                <p className="mt-0.5 truncate text-[11px] text-[#77787e]">{detail}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
