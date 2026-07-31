import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Layout } from "./components/Layout";
import { HomePage } from "./features/home/HomePage";
import { SubmitPage } from "./features/submit/SubmitPage";
import { ProjectPage } from "./features/project/ProjectPage";
import { AboutPage } from "./features/about/AboutPage";

const qc = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

export function App() {
  return (
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<HomePage />} />
            <Route path="pulse" element={<Navigate to="/" replace />} />
            <Route path="submit" element={<SubmitPage />} />
            <Route path="p/:owner/:repo" element={<ProjectPage />} />
            <Route path="about" element={<AboutPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
