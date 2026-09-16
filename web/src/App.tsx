import { useCallback, useEffect, useState } from "react";
import { Route, Routes } from "react-router-dom";
import { ApiRequestError, getMe } from "./api.js";
import { ErrorState, LoadingCard, Page } from "./components/ui.js";
import { Landing } from "./pages/Landing.js";
import { Home } from "./pages/Home.js";
import { CheckEmail } from "./pages/CheckEmail.js";
import { Expired } from "./pages/Expired.js";
import { Design } from "./pages/Design.js";
import { ExperimentLocked } from "./pages/ExperimentLocked.js";
import { Prep } from "./pages/Prep.js";
import { Run } from "./pages/Run.js";
import { Verdict } from "./pages/Verdict.js";

type Session =
  | { status: "loading" }
  | { status: "authed"; email: string }
  | { status: "anon" }
  | { status: "error" };

function RootGate() {
  const [session, setSession] = useState<Session>({ status: "loading" });

  const load = useCallback(async () => {
    setSession({ status: "loading" });
    try {
      const me = await getMe();
      setSession({ status: "authed", email: me.email });
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 401) {
        setSession({ status: "anon" });
      } else {
        setSession({ status: "error" });
      }
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (session.status === "loading") {
    return (
      <Page>
        <LoadingCard />
      </Page>
    );
  }
  if (session.status === "error") {
    return (
      <Page>
        <ErrorState
          title="We could not load your account"
          body="Check your connection and try again."
          actionLabel="Try again"
          onAction={() => void load()}
        />
      </Page>
    );
  }
  if (session.status === "authed") {
    return <Home email={session.email} onSignedOut={() => setSession({ status: "anon" })} />;
  }
  return <Landing />;
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<RootGate />} />
      <Route path="/auth/check-email" element={<CheckEmail />} />
      <Route path="/auth/expired" element={<Expired />} />
      <Route path="/design" element={<Design />} />
      <Route path="/experiments/:id" element={<ExperimentLocked />} />
      <Route path="/experiments/:id/prep" element={<Prep />} />
      <Route path="/experiments/:id/run" element={<Run />} />
      <Route path="/experiments/:id/verdict" element={<Verdict />} />
    </Routes>
  );
}
