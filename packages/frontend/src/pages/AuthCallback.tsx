import { useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { usePlatform } from "../context/PlatformContext";

export default function AuthCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { setSpotifyToken, setUserId } = usePlatform();

  useEffect(() => {
    const token = searchParams.get("t");
    const artists = searchParams.get("artists");
    const userId = searchParams.get("userId");

    if (token) {
      setSpotifyToken(token);
      if (userId) {
        setUserId(Number(userId));
      }
      navigate(`/hub?artists=${artists || ""}`, { replace: true });
    } else {
      navigate("/", { replace: true });
    }
  }, [searchParams, navigate, setSpotifyToken, setUserId]);

  return null;
}
