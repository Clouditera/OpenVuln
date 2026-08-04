import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Layout } from "./components/Layout";
import { ProductHomePage } from "./features/home/ProductHomePage";
import { SubmitPage } from "./features/submit/SubmitPage";
import { ProjectPage } from "./features/project/ProjectPage";
import { AboutPage } from "./features/about/AboutPage";
import { MyProjectsPage } from "./features/my/MyProjectsPage";
import { PopupCallbackPage } from "./features/auth/PopupCallbackPage";

const qc = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

/** 单着陆页：深色 deck（task-5ee34751 融合定稿）。 */
const Landing = ProductHomePage;

export function App() {
  return (
    <QueryClientProvider client={qc}>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Landing />} />
            <Route path="pulse" element={<Navigate to="/" replace />} />
            <Route path="submit" element={<SubmitPage />} />
            <Route path="p/:owner/:repo" element={<ProjectPage />} />
            <Route path="my" element={<MyProjectsPage />} />
            <Route path="about" element={<AboutPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
          {/* Popup OAuth callback — standalone (no Layout) */}
          <Route path="/auth/popup-callback" element={<PopupCallbackPage />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
