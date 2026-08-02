import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Layout } from "./components/Layout";
import { HomePage } from "./features/home/HomePage";
import { ZaiLandingPage } from "./features/home/ZaiLandingPage";
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

const Landing = import.meta.env.VITE_LANDING === "zai" ? ZaiLandingPage : HomePage;

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
            <Route path="about" element={<AboutPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
