import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ChevronDown, Github, Search, Shield } from "lucide-react";
import Swiper from "swiper";
import { Keyboard, Mousewheel, Pagination } from "swiper/modules";
import "swiper/css";
import { api } from "../../shared/api/client";
import { Button } from "../../components/Button";
import { EmptyState } from "../../components/EmptyState";
import { ProjectRow } from "../../components/ProjectRow";
import { RepoSubmitForm } from "../../components/RepoSubmitForm";
import { HeroStats } from "../../components/HeroStats";
import { EventTicker } from "../../components/EventTicker";
import { ScanDurationNotice } from "../../components/ScanDurationNotice";
import { AuthButton } from "../../components/AuthButton";

/**
 * 深色 deck（task-5ee34751 fish 定稿）：PPT 式两页整页滚动恢复，
 * 视觉全面对齐协作者着陆页（bg-black / #111216 卡 / 白主按钮 / 系统字栈）。
 * 页1 = 品牌 hero（协作者原版）+ HeroStats + EventTicker；
 * 页2 = 项目列表（内部滚动，状态跨导航保留）。
 */
const ZAI_HF_AVATAR = "https://huggingface.co/api/avatars/zai-org";
const OWN_REPO = "https://github.com/Clouditera/OpenVuln";

/** 列表状态跨导航保留：模块级缓存，重挂载时恢复 */
const listCache = { sort: "stars" as "newest" | "stars", q: "", scrollTop: 0 };

export function ProductHomePage() {
  const [q, setQState] = useState(listCache.q);
  const [sort, setSortState] = useState<"newest" | "stars">(listCache.sort);
  const setQ = (v: string) => { listCache.q = v; setQState(v); };
  const setSort = (v: "newest" | "stars") => { listCache.sort = v; setSortState(v); };
  const containerRef = useRef<HTMLDivElement>(null);
  const dotsRef = useRef<HTMLDivElement>(null);
  const swiperRef = useRef<Swiper | null>(null);

  const overview = useQuery({
    queryKey: ["public", "overview"],
    queryFn: api.overview,
    refetchInterval: 15_000,
  });

  const PAGE_SIZE = 20;
  const projects = useInfiniteQuery({
    queryKey: ["public", "projects", sort],
    queryFn: ({ pageParam }) => api.listProjects({ sort, page: pageParam, page_size: PAGE_SIZE }),
    initialPageParam: 1,
    getNextPageParam: (last, _pages, lastParam) =>
      lastParam * PAGE_SIZE < (last.total ?? 0) ? lastParam + 1 : undefined,
  });
  const allItems = useMemo(() => projects.data?.pages.flatMap((pg) => pg.items) ?? [], [projects.data]);
  const listRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const rootEl = listRef.current;
    const sEl = sentinelRef.current;
    if (!rootEl || !sEl) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && projects.hasNextPage && !projects.isFetchingNextPage) {
          void projects.fetchNextPage();
        }
      },
      { root: rootEl, rootMargin: "240px" },
    );
    io.observe(sEl);
    return () => io.disconnect();
  }, [projects.hasNextPage, projects.isFetchingNextPage, projects.fetchNextPage]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return allItems;
    return allItems.filter(
      (p) =>
        p.full_name.toLowerCase().includes(needle) ||
        (p.description ?? "").toLowerCase().includes(needle),
    );
  }, [allItems, q]);

  useEffect(() => {
    if (!containerRef.current || !dotsRef.current) return;
    const sw = new Swiper(containerRef.current, {
      modules: [Mousewheel, Keyboard, Pagination],
      direction: "vertical",
      slidesPerView: 1,
      simulateTouch: false, // 鼠标拖拽会 preventDefault 阻断文本选择；滚轮/键盘/圆点覆盖桌面导航
      speed: 620,
      mousewheel: { thresholdDelta: 4, noMousewheelClass: "swiper-no-mousewheel" },
      keyboard: { enabled: true, onlyInViewport: true },
      pagination: {
        el: dotsRef.current,
        clickable: true,
        bulletElement: "button",
        bulletClass: "ov-dot",
        bulletActiveClass: "ov-dot-active",
      },
    });
    swiperRef.current = sw;
    if (window.location.hash === "#projects") {
      sw.slideTo(1, 0);
    }
    sw.on("slideChange", () => {
      const h = sw.activeIndex === 1 ? "#projects" : "#welcome";
      if (window.location.hash !== h) {
        history.replaceState(null, "", h === "#welcome" ? window.location.pathname : h);
      }
    });
    return () => {
      swiperRef.current = null;
      sw.destroy(true, true);
    };
  }, []);

  useEffect(() => {
    if (listRef.current && allItems.length > 0 && listCache.scrollTop > 0) {
      listRef.current.scrollTop = listCache.scrollTop;
    }
  }, [allItems.length]);

  return (
    <div className="openvuln-home relative isolate bg-black text-white">
      <div className="openvuln-glow pointer-events-none fixed inset-0 -z-10" />

      {/* 悬浮顶栏：左 wordmark / 右登录态 + GitHub（覆盖两页） */}
      <header className="absolute inset-x-0 top-0 z-20 flex items-center justify-between px-5 py-5 sm:px-8 sm:py-7">
        <button
          type="button"
          onClick={() => swiperRef.current?.slideTo(0)}
          className="openvuln-title font-display text-[17px] font-bold tracking-tight focus-ring-dark rounded-md"
        >
          OpenVuln
        </button>
        <div className="flex items-center gap-2">
          <AuthButton appearance="dark" />
          <a
            href={OWN_REPO}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-9 items-center gap-2 rounded-full border border-[#333] bg-[#030303] px-3.5 text-xs font-medium text-[#acacb0] transition hover:border-[#484a58] hover:bg-[#111216] hover:text-white focus-ring-dark"
          >
            <Github size={14} />
            GitHub
          </a>
        </div>
      </header>

      <div ref={containerRef} className="swiper h-screen w-full">
        <div className="swiper-wrapper">
          {/* 第一页：协作者品牌 hero + 统计 + 事件流 */}
          <section className="swiper-slide relative">
            <div className="flex h-full flex-col items-center justify-center overflow-hidden px-5 text-center sm:px-8">
              <div className="flex w-full max-w-3xl flex-col items-center">
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

                <p className="mt-6 max-w-2xl text-balance text-base leading-7 text-[#acacb0] sm:text-lg">
                  AI-powered vulnerability discovery for the open-source world.
                </p>

                <RepoSubmitForm
                  size="hero"
                  appearance="dark"
                  className="mt-8 w-full max-w-2xl"
                />
                <ScanDurationNotice className="mt-4 w-full max-w-2xl" />

                <div className="mt-7 w-full">
                  <HeroStats stats={overview.data} />
                </div>
                <div className="mt-8 w-full max-w-3xl text-left">
                  <EventTicker events={overview.data?.recent} />
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => swiperRef.current?.slideTo(1)}
              aria-label="Scroll to projects"
              className="absolute bottom-5 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-1 rounded-md text-[#696a70] transition-colors hover:text-[#acacb0] focus-ring-dark"
            >
              <span className="font-mono text-[11px] uppercase tracking-wider">Explore</span>
              <ChevronDown size={18} className="animate-bounce motion-reduce:animate-none" />
            </button>
          </section>

          {/* 第二页：项目列表 */}
          <section className="swiper-slide border-t border-[#26272c]">
            <div className="flex h-full flex-col">
              <div className="flex min-h-0 flex-1 flex-col px-6 pt-20">
                <div className="mx-auto flex w-full max-w-6xl flex-wrap items-end justify-between gap-3 pb-4">
                  <div>
                    <p className="font-mono text-[11px] font-medium uppercase tracking-wider text-ink-tertiary">
                      Explore
                    </p>
                    <h2 className="mt-0.5 font-display text-lg font-semibold text-ink">
                      Representative projects
                    </h2>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <Search
                        size={16}
                        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-tertiary"
                      />
                      <input
                        type="search"
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        placeholder="Search projects..."
                        className="h-9 w-52 rounded-full border border-[#333] bg-[#030303] pl-9 pr-3 text-sm text-ink placeholder:text-ink-tertiary focus-ring-dark"
                      />
                    </div>
                    <select
                      value={sort}
                      onChange={(e) => setSort(e.target.value as "newest" | "stars")}
                      className="h-9 rounded-full border border-[#333] bg-[#030303] px-3 text-sm text-ink focus-ring-dark"
                    >
                      <option value="stars">Most stars</option>
                      <option value="newest">Recently added</option>
                    </select>
                  </div>
                </div>

                <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col">
                  <div
                    ref={listRef}
                    data-scrollable
                    onScroll={(e) => {
                      listCache.scrollTop = e.currentTarget.scrollTop;
                    }}
                    className="swiper-no-mousewheel min-h-0 flex-1 overflow-y-auto border-t border-line pr-4"
                  >
                    {projects.isLoading ? (
                      <div className="space-y-3 py-6">
                        {Array.from({ length: 5 }).map((_, i) => (
                          <div key={i} className="h-20 animate-pulse rounded-xl bg-surface-raised" />
                        ))}
                      </div>
                    ) : projects.isError ? (
                      <EmptyState
                        icon={Shield}
                        title="Could not load projects"
                        description="Is the OpenVuln API running?"
                      />
                    ) : filtered.length === 0 ? (
                      <EmptyState
                        icon={Shield}
                        title="No projects yet."
                        description="Submit the first open-source project to be scanned by VulnHunter."
                        action={
                          <Link to="/submit">
                            <Button>Submit a project</Button>
                          </Link>
                        }
                      />
                    ) : (
                      <>
                        {filtered.map((p) => <ProjectRow key={p.id} project={p} />)}
                        <div ref={sentinelRef} className="h-px" />
                        {projects.isFetchingNextPage && (
                          <div className="py-4 text-center font-mono text-xs text-ink-tertiary">
                            Loading more…
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  <div className="flex justify-end pt-4 font-mono text-sm text-ink-tertiary">
                    {projects.data?.pages[0]?.total ?? 0} projects
                  </div>
                  <div className="mt-3 flex flex-col gap-2 border-t border-line py-6 text-[13px] text-ink-secondary sm:flex-row sm:items-center sm:justify-between">
                    <p>
                      © 2026 OpenVuln · Powered by{" "}
                      <a
                        href="https://vulnhunt.clouditera.com"
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium text-ink hover:text-accent-600"
                      >
                        VulnHunter
                      </a>
                    </p>
                    <div className="flex flex-wrap gap-x-5 gap-y-1">
                      <a href={OWN_REPO} target="_blank" rel="noreferrer" className="hover:text-ink">
                        GitHub
                      </a>
                      <Link to="/about" className="hover:text-ink">
                        About
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>

        {/* Swiper 圆点分页（右缘） */}
        <div ref={dotsRef} className="ov-dots" aria-label="Slides" />
        <style>{`
          .ov-dots { position: absolute; right: 10px; top: 50%; transform: translateY(-50%); z-index: 10; display: flex; flex-direction: column; gap: 10px; }
          .ov-dots .ov-dot { width: 8px; height: 8px; border-radius: 9999px; border: none; padding: 0; cursor: pointer; background: rgb(105 106 112 / 0.55); transition: background 0.2s; }
          .ov-dots .ov-dot:hover { background: #acacb0; }
          .ov-dots .ov-dot-active { background: #ebecf0; }
          @media (max-width: 768px) { .ov-dots { display: none; } }
        `}</style>
      </div>
    </div>
  );
}
