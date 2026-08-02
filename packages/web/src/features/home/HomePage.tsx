import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ChevronDown, Search, Shield } from "lucide-react";
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

/**
 * PPT 式两页 deck（fish v1.8）：Swiper vertical 驱动（滚轮/键盘/圆点/触屏），
 * 页1 = 欢迎 + 滚动信息流；页2 = Pulse 趋势（固定）+ 项目列表（内部滚动）。
 */
/** 列表状态跨导航保留（fish v1.12）：模块级缓存，HomePage 重挂载时恢复 */
const listCache = { sort: "stars" as "newest" | "stars", q: "", scrollTop: 0 };

export function HomePage() {
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

  // 无限滚动：哨兵进入列表视口即取下一页
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
    const items = allItems;
    const needle = q.trim().toLowerCase();
    if (!needle) return items;
    return items.filter(
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
      simulateTouch: false, // 鼠标拖拽会 preventDefault 阻断文本选择；滚轮/键盘/圆点已覆盖桌面导航
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
    // hash 直达：/#projects → 列表页（项目详情「返回」落点）
    if (window.location.hash === "#projects") {
      sw.slideTo(1, 0);
    }
    // slide 变化同步 hash（replace，不污染历史）
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

  // 滚动位置：滚动时持续保存，数据就绪后恢复
  useEffect(() => {
    if (listRef.current && allItems.length > 0 && listCache.scrollTop > 0) {
      listRef.current.scrollTop = listCache.scrollTop;
    }
  }, [allItems.length]);

  return (
    <div ref={containerRef} className="swiper h-[calc(100vh-3.5rem)] w-full">
      <div className="swiper-wrapper">
        {/* 第一页：欢迎 + 滚动信息流 */}
        <section className="swiper-slide relative">
          <div className="flex h-full flex-col items-center justify-center overflow-hidden px-6 text-center">
            <div className="flex w-full max-w-5xl flex-col items-center">
              <h1
                className="font-display font-bold tracking-tight text-ink"
                style={{ fontSize: "clamp(2.4rem, 5.5vw, 3.4rem)", lineHeight: 1.15 }}
              >
                Continuous AI vulnerability discovery for open source.
              </h1>
              <p className="mt-5 max-w-2xl text-base leading-relaxed text-ink-secondary">
                Submit any public GitHub project. The VulnHunter engine scans the default branch,
                verifies findings with automated PoC, and discloses them to verified maintainers
                first.
              </p>
              <div className="mt-10 w-full max-w-xl text-left">
                <RepoSubmitForm size="hero" />
              </div>
              <div className="mt-14 w-full">
                <HeroStats stats={overview.data} />
              </div>
              <div className="mt-10 w-full max-w-3xl text-left">
                <EventTicker events={overview.data?.recent} />
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => swiperRef.current?.slideTo(1)}
            aria-label="Scroll to projects"
            className="absolute bottom-5 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-1 rounded-md text-ink-tertiary transition-colors hover:text-ink focus-ring"
          >
            <span className="font-mono text-[11px] uppercase tracking-wider">Explore</span>
            <ChevronDown size={18} className="animate-bounce motion-reduce:animate-none" />
          </button>
        </section>

        {/* 第二页：项目列表（Pulse 暂缓，fish v1.9） */}
        <section className="swiper-slide border-t border-line bg-surface">
          <div className="flex h-full flex-col">
            <div className="flex min-h-0 flex-1 flex-col px-6 pt-10">
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
                      className="h-9 w-52 rounded-md border border-line bg-surface-raised pl-9 pr-3 text-sm text-ink placeholder:text-ink-tertiary focus-ring"
                    />
                  </div>
                  <select
                    value={sort}
                    onChange={(e) => setSort(e.target.value as "newest" | "stars")}
                    className="h-9 rounded-md border border-line bg-surface-raised px-2.5 text-sm text-ink focus-ring"
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
                        <div key={i} className="h-20 animate-pulse rounded-md bg-surface-sunken" />
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
                      href="https://github.com/search?q=vulnhunter&type=repositories"
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium text-ink hover:text-accent-600"
                    >
                      VulnHunter
                    </a>
                  </p>
                  <div className="flex flex-wrap gap-x-5 gap-y-1">
                    <a
                      href="https://github.com/Clouditera/OpenVuln"
                      target="_blank"
                      rel="noreferrer"
                      className="hover:text-ink"
                    >
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
        .ov-dots .ov-dot { width: 8px; height: 8px; border-radius: 9999px; border: none; padding: 0; cursor: pointer; background: rgb(187 195 204 / 0.55); transition: background 0.2s; }
        .ov-dots .ov-dot:hover { background: #BBC3CC; }
        .ov-dots .ov-dot-active { background: #298CFF; }
        @media (max-width: 768px) { .ov-dots { display: none; } }
      `}</style>
    </div>
  );
}
