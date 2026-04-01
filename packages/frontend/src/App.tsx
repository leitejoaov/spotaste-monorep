import { Routes, Route, useLocation, useSearchParams } from "react-router-dom";
import Login from "./pages/Login";
import Hub from "./pages/Hub";
import Judge from "./pages/Judge";
import AudioFeatures from "./pages/AudioFeatures";
import TasteAnalysis from "./pages/TasteAnalysis";
import Library from "./pages/Library";
import TextToPlaylist from "./pages/TextToPlaylist";
import PlaylistHistory from "./pages/PlaylistHistory";
import AuthCallback from "./pages/AuthCallback";
import Privacy from "./pages/Privacy";
import Settings from "./pages/Settings";
import Sidebar from "./components/Sidebar";
import { PlatformProvider, usePlatform } from "./context/PlatformContext";

function AppContent() {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { isLoggedIn } = usePlatform();

  const hideSidebar = location.pathname === "/" || location.pathname === "/auth-callback";
  const hubData = searchParams.get("hubData") || searchParams.get("artists") || "";

  return (
    <>
      {isLoggedIn && !hideSidebar && <Sidebar hubData={hubData} />}
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/auth-callback" element={<AuthCallback />} />
        <Route path="/hub" element={<Hub />} />
        <Route path="/judge" element={<Judge />} />
        <Route path="/audio-features" element={<AudioFeatures />} />
        <Route path="/taste-analysis" element={<TasteAnalysis />} />
        <Route path="/library" element={<Library />} />
        <Route path="/text-to-playlist" element={<TextToPlaylist />} />
        <Route path="/playlist-history" element={<PlaylistHistory />} />
      <Route path="/privacy" element={<Privacy />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </>
  );
}

export default function App() {
  return (
    <PlatformProvider>
      <AppContent />
    </PlatformProvider>
  );
}
