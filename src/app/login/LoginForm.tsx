"use client";
import { useActionState } from "react";
import { login } from "./actions";

export default function LoginForm() {
  const [state, action, pending] = useActionState(login, undefined);
  return (
    <main className="login">
      <form action={action}>
        <h1>Port Calibrate</h1>
        <p>Private dashboard. Enter the site password.</p>
        <input type="password" name="password" placeholder="Password" autoComplete="current-password" required autoFocus />
        {state?.error && <div className="error">{state.error}</div>}
        <button className="btn primary" type="submit" disabled={pending}>
          {pending ? "Checking…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
