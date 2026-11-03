// FILE: src/pages/Login.tsx
import { useState } from "react";
import { AlertCircle, LoaderCircle } from "lucide-react";
import { Navigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { api, apiUrl, errorMessage, setCsrfToken } from "../services/api";

const signInErrors: Record<string, string> = {
  client_configuration:
    "Google rejected this app's sign-in credentials. Please contact the app administrator.",
  redirect_configuration:
    "Google sign-in has an incorrect return address. Please contact the app administrator.",
  session_expired:
    "Your sign-in session expired or cookies were unavailable. Start again from the sign-in page with cookies enabled.",
  authorization_expired:
    "This Google sign-in attempt expired. Please start again.",
  cancelled:
    "Google sign-in was cancelled. You can try again when you're ready.",
  profile_invalid:
    "Google account verification failed. Please start sign-in again.",
  storage_unavailable:
    "We couldn't save your sign-in. Please try again shortly.",
  session_unavailable:
    "The sign-in service is temporarily unavailable. Please try again shortly.",
  provider_error:
    "Google sign-in is temporarily unavailable. Please try again.",
};

const GoogleIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
    <path
      fill="#4285F4"
      d="M21.6 12.2c0-.7-.1-1.4-.2-2.2H12v4.3h5.4a4.6 4.6 0 0 1-2 3v2.8h3.5c2-1.9 2.7-4.6 2.7-7.9Z"
    />
    <path
      fill="#34A853"
      d="M12 22c2.7 0 5-.9 6.9-2.5l-3.5-2.8c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H2.8v2.8A10.4 10.4 0 0 0 12 22Z"
    />
    <path
      fill="#FBBC05"
      d="M6.4 13.6a6.6 6.6 0 0 1 0-3.2V7.6H2.8a10.4 10.4 0 0 0 0 8.8l3.6-2.8Z"
    />
    <path
      fill="#EA4335"
      d="M12 6.3c1.5 0 2.8.5 3.8 1.5L19 4.6A10 10 0 0 0 12 2a10.4 10.4 0 0 0-9.2 5.6l3.6 2.8C7.2 8.1 9.4 6.3 12 6.3Z"
    />
  </svg>
);


export function Login() {
  const { session, error, refresh } = useAuth();
  const [params] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [failure, setFailure] = useState("");
  const [busy, setBusy] = useState(false);
  const reason = params.get("reason") ?? "";
  const oauthError =
    params.has("error") || params.has("oauthError")
      ? Object.hasOwn(signInErrors, reason)
        ? signInErrors[reason]
        : "Sign-in could not be completed. Please try again."
      : "";

  if (session) return <Navigate to="/dashboard" replace />;

  return (
    <main className="login-page">
      <section className="login-card">
        <h1>Login</h1>

        {(failure || error || oauthError) && (
          <div className="notice error" role="alert">
            <AlertCircle size={16} />
            <span>{failure || error || oauthError}</span>
          </div>
        )}

        {/* Google sign-in */}
        <a className="google-button" href={apiUrl("/api/auth/google")}>
          <GoogleIcon />
          Continue with Google
        </a>

        <div className="login-divider">
          <span>or sign in with email</span>
        </div>

        {/* Email / password form */}
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setFailure("");
            try {
              const token = await api<{ csrfToken: string }>("/auth/csrf");
              setCsrfToken(token.csrfToken);
              await api("/auth/login", {
                method: "POST",
                body: JSON.stringify({ email, password }),
              });
              await refresh();
            } catch (e) {
              setFailure(errorMessage(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          <input
            aria-label="Email ID"
            type="email"
            autoComplete="username"
            required
            placeholder="Email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            aria-label="Password"
            type="password"
            autoComplete="current-password"
            required
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button className="login-submit" disabled={busy}>
            {busy ? <LoaderCircle size={16} className="spin" /> : "Sign in"}
          </button>
        </form>

        <p className="login-help">
          First time? Sign in with Google. You can enable password login in your
          account settings.
        </p>
      </section>
    </main>
  );
}
