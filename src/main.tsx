console.log("VITE_SUPABASE_URL:", import.meta.env.VITE_SUPABASE_URL);
console.log("VITE_SUPABASE_ANON_KEY set?:", Boolean(import.meta.env.VITE_SUPABASE_ANON_KEY));

import React from "react";
import ReactDOM from "react-dom/client";
import HabitTrackerApp from "./HabitTrackerApp";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <HabitTrackerApp />
  </React.StrictMode>
);
