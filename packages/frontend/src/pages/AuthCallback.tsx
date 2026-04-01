import { useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";

export default function AuthCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  useEffect(() => {
    const token = searchParams.get("t");
    const artists = searchParams.get("artists");

    if (token) {
      sessionStorage.setItem("spotaste_token", token);
      // Navigate to hub, replacing history so back button doesn't return here
      navigate(`/hub?artists=${artists || ""}`, { replace: true });
    } else {
      navigate("/", { replace: true });
    }
  }, [searchParams, navigate]);

  return null;
}
