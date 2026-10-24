import { useState } from "react";
import { apiClient } from "../../shared/api";
import { navigate } from "../../shared/router";

export function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <main className="workspace narrow">
      <h1>Вход организатора</h1>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy) return;
          setBusy(true);
          setError(null);
          try {
            await apiClient.login({ email, password });
            navigate("/organize");
          } catch (e) {
            setError(e instanceof Error ? e.message : "Не удалось войти");
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Email
          <input
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label>
          Пароль
          <input
            type="password"
            autoComplete="current-password"
            required
            minLength={12}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <button disabled={busy}>{busy ? "Вход…" : "Войти"}</button>
      </form>
      <p>Учётную запись выдаёт администратор площадки.</p>
    </main>
  );
}
