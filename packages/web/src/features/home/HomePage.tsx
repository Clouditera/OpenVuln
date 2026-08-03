import { Github } from "lucide-react";
import { AuthButton } from "../../components/AuthButton";
import { RepoSubmitForm } from "../../components/RepoSubmitForm";
import { ScanDurationNotice } from "../../components/ScanDurationNotice";

const ZAI_HF_AVATAR = "https://huggingface.co/api/avatars/zai-org";

export function HomePage() {
  return (
    <main className="openvuln-home relative isolate flex min-h-screen overflow-hidden bg-black text-white">
      <div className="openvuln-glow pointer-events-none absolute inset-0 -z-10" />

      <header className="absolute inset-x-0 top-0 z-10 flex items-center justify-end gap-2 px-5 py-5 sm:px-8 sm:py-7">
        <AuthButton appearance="dark" />
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

        <ScanDurationNotice className="w-full max-w-3xl" />
      </section>
    </main>
  );
}
