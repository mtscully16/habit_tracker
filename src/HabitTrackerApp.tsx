const _dbgUrl = import.meta.env.VITE_SUPABASE_URL;
const _dbgKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Plus, RotateCcw, Settings, TrendingUp, X, LogIn, LogOut } from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { motion } from "framer-motion";
import { createClient, type Session } from "@supabase/supabase-js";


/**
 * Habit Tracker (single-file React)
 * - Do habits (+1 when checked)
 * - Do Not habits (-1 when checked)
 * - User can add/remove habits in either list
 * - Tracks per-day (local date) with persistent storage (localStorage)
 * - Optional cloud sync via Supabase + Google Sign-In (last write wins)
 * - Cumulative graph by week/month/year/all-time
 *   value starts at 1; each day: value = value * (1 + RATE_PER_POINT * n)
 */

const STORAGE_KEY = "habit-tracker-v2";

// Growth factor per point (n): value_next = value_prev * (1 + RATE_PER_POINT * n)
const RATE_PER_POINT = 0.01;

const DEFAULT_POSITIVE = ["Exercise", "Drink water", "Read 20 minutes", "Plan tomorrow", "Meditate"];
const DEFAULT_NEGATIVE = ["Junk food", "Unplanned screen time", "Stayed up late", "Skipped meals", "Procrastinated"];

type DayState = {
  positive: boolean[]; // aligned to settings.positive
  negative: boolean[]; // aligned to settings.negative
};

type SettingsState = {
  positive: string[];
  negative: string[];
};

type GraphRange = "week" | "month" | "year" | "all";

type UIState = {
  selectedDate: string; // YYYY-MM-DD
  graphRange: GraphRange;
  graphMonth: number; // 0-11
  graphYear: number;
};

type AppState = {
  version: 2;
  settings: SettingsState;
  days: Record<string, DayState>;
  ui: UIState;
};

function getEnv(name: string): string | undefined {
  // Supports both Vite and Next.js-style envs.
  const anyImportMeta = import.meta as any;
  const fromVite = anyImportMeta?.env?.[name];
  const fromNext = (globalThis as any)?.process?.env?.[name];
  return (fromVite ?? fromNext) as string | undefined;
}

const SUPABASE_URL =
  getEnv("VITE_SUPABASE_URL") ||
  getEnv("NEXT_PUBLIC_SUPABASE_URL") ||
  getEnv("REACT_APP_SUPABASE_URL");

const SUPABASE_ANON_KEY =
  getEnv("VITE_SUPABASE_ANON_KEY") ||
  getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY") ||
  getEnv("REACT_APP_SUPABASE_ANON_KEY");

const supabase =
  SUPABASE_URL && SUPABASE_ANON_KEY ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

function toLocalISODate(d: Date = new Date()): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function parseLocalISODate(dateStr: string): Date {
  const [y, m, d] = String(dateStr)
    .split("-")
    .map((v) => Number(v));
  return new Date(y, (m || 1) - 1, d || 1);
}

function addDays(date: Date, delta: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + delta);
  return d;
}

function formatShortMD(dateStr: string): string {
  return String(dateStr).slice(5).replace("-", "/");
}

function startOfWeekMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = (day + 6) % 7;
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - diff);
  return d;
}

function endOfWeekSunday(date: Date): Date {
  const start = startOfWeekMonday(date);
  return addDays(start, 6);
}

function endOfMonth(year: number, monthIndex: number): Date {
  return new Date(year, monthIndex + 1, 0);
}

function normalizeBoolArray(input: any, length: number): boolean[] {
  const arr = Array.isArray(input) ? input : [];
  return Array.from({ length }, (_, i) => Boolean(arr[i]));
}

function ensureDayShape(day: any, posLen: number, negLen: number): DayState {
  return {
    positive: normalizeBoolArray(day?.positive, posLen),
    negative: normalizeBoolArray(day?.negative, negLen),
  };
}

function buildDefaultState(): AppState {
  const today = toLocalISODate();
  const posLen = DEFAULT_POSITIVE.length;
  const negLen = DEFAULT_NEGATIVE.length;
  return {
    version: 2,
    settings: {
      positive: DEFAULT_POSITIVE,
      negative: DEFAULT_NEGATIVE,
    },
    days: {
      [today]: {
        positive: Array(posLen).fill(false),
        negative: Array(negLen).fill(false),
      },
    },
    ui: {
      selectedDate: today,
      graphRange: "week",
      graphMonth: new Date().getMonth(),
      graphYear: new Date().getFullYear(),
    },
  };
}

function ensureStateShape(state: any): AppState {
  const fallback = buildDefaultState();
  if (!state || typeof state !== "object") return fallback;

  const settings = (state as any).settings || {};
  const positive: string[] = Array.isArray(settings.positive) && settings.positive.length
    ? settings.positive.map((s: any) => String(s)).slice(0, 100)
    : DEFAULT_POSITIVE;
  const negative: string[] = Array.isArray(settings.negative) && settings.negative.length
    ? settings.negative.map((s: any) => String(s)).slice(0, 100)
    : DEFAULT_NEGATIVE;

  const posLen = positive.length;
  const negLen = negative.length;

  const days = (state as any).days && typeof (state as any).days === "object" ? (state as any).days : {};
  const normalizedDays: Record<string, DayState> = {};
  for (const [k, v] of Object.entries(days)) normalizedDays[k] = ensureDayShape(v, posLen, negLen);

  const today = toLocalISODate();
  if (!normalizedDays[today]) normalizedDays[today] = ensureDayShape(null, posLen, negLen);

  const ui = (state as any).ui || {};
  const selectedDate = typeof ui.selectedDate === "string" ? ui.selectedDate : today;
  const graphRange: GraphRange = typeof ui.graphRange === "string" ? (ui.graphRange as GraphRange) : "week";
  const graphMonth = Number.isInteger(ui.graphMonth) ? ui.graphMonth : new Date().getMonth();
  const graphYear = Number.isInteger(ui.graphYear) ? ui.graphYear : new Date().getFullYear();

  const safeGraphRange: GraphRange =
    graphRange === "week" || graphRange === "month" || graphRange === "year" || graphRange === "all"
      ? graphRange
      : "week";

  return {
    version: 2,
    settings: { positive, negative },
    days: normalizedDays,
    ui: {
      selectedDate: normalizedDays[selectedDate] ? selectedDate : today,
      graphRange: safeGraphRange,
      graphMonth: clamp(graphMonth, 0, 11),
      graphYear,
    },
  };
}

function removeAt<T>(arr: T[], idx: number): T[] {
  return arr.filter((_, i) => i !== idx);
}

function insertAtEnd<T>(arr: T[], item: T): T[] {
  return [...arr, item];
}

function getLocalState(): AppState {
  const raw = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
  const parsed = raw ? safeParse(raw) : null;
  return ensureStateShape(parsed);
}

export default function HabitTrackerApp() {
  const [state, setState] = useState<AppState>(() => getLocalState());
  const [session, setSession] = useState<Session | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
 const [cloudStatus, setCloudStatus] = useState<string>(() => {
  if (!supabase) return "Cloud sync unavailable (Supabase client not initialized).";
  return "Cloud sync ready.";
});


  const cloudUpdatedAtRef = useRef<string | null>(null);
  const lastUploadedHashRef = useRef<string | null>(null);
  const suppressNextUploadRef = useRef(false);

  const selectedDate = state.ui.selectedDate;
  const graphRange = state.ui.graphRange;
  const graphMonth = state.ui.graphMonth;
  const graphYear = state.ui.graphYear;

  const posLen = state.settings.positive.length;
  const negLen = state.settings.negative.length;

  // Persist locally always.
  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // ignore quota/storage errors
    }
  }, [state]);

  // Initialize auth session and listen for changes.
  useEffect(() => {
    if (!supabase) return;
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session ?? null);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => {
      mounted = false;
      sub?.subscription?.unsubscribe();
    };
  }, []);

  // On sign-in, pull from cloud. If no cloud row exists yet, push local up.
  useEffect(() => {
    if (!supabase) return;
    const userId = session?.user?.id;
    if (!userId) return;

    let cancelled = false;

    (async () => {
      try {
        setCloudStatus("Syncing: loading cloud state...");

        const { data, error } = await supabase
          .from("habit_states")
          .select("state, updated_at")
          .eq("user_id", userId)
          .maybeSingle();

        if (cancelled) return;
        if (error) {
          setCloudStatus(`Cloud load failed: ${error.message}`);
          return;
        }

        if (!data) {
          // First-time user: upload local state.
          setCloudStatus("No cloud state yet. Uploading local state...");
          await uploadToCloud(userId, state);
          return;
        }

        cloudUpdatedAtRef.current = data.updated_at ?? null;

        // Last-write-wins: cloud is authoritative at login.
        suppressNextUploadRef.current = true;
        setState(ensureStateShape(data.state));
        setCloudStatus("Cloud state loaded.");

        // Clear suppression after the state commit tick.
        setTimeout(() => {
          suppressNextUploadRef.current = false;
        }, 0);
      } catch (e: any) {
        setCloudStatus(`Cloud load failed: ${e?.message ?? "unknown error"}`);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id]);

  async function uploadToCloud(userId: string, nextState: AppState) {
    if (!supabase) return;

    // Compute a simple hash to avoid uploading identical payload repeatedly.
    const payload = JSON.stringify(nextState);
    const hash = String(payload.length) + ":" + payload.slice(0, 64) + ":" + payload.slice(-64);
    if (lastUploadedHashRef.current === hash) return;

    const nowIso = new Date().toISOString();

    const { error } = await supabase
      .from("habit_states")
      .upsert({ user_id: userId, state: nextState, updated_at: nowIso }, { onConflict: "user_id" });

    if (error) {
      setCloudStatus(`Cloud save failed: ${error.message}`);
      return;
    }

    lastUploadedHashRef.current = hash;
    cloudUpdatedAtRef.current = nowIso;
    setCloudStatus(`Synced ${new Date(nowIso).toLocaleString()}`);
  }

  // Debounced cloud save on state changes (last write wins).
  useEffect(() => {
    if (!supabase) return;
    const userId = session?.user?.id;
    if (!userId) return;

    if (suppressNextUploadRef.current) return;

    const timer = window.setTimeout(() => {
      // If we just loaded from cloud and haven't changed anything, avoid immediate re-upload.
      uploadToCloud(userId, state);
    }, 800);

    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, session?.user?.id]);

  const dayData = state.days[selectedDate] || ensureDayShape(null, posLen, negLen);

  const points = useMemo(() => {
    const pos = dayData.positive.reduce((acc, v) => acc + (v ? 1 : 0), 0);
    const neg = dayData.negative.reduce((acc, v) => acc + (v ? 1 : 0), 0);
    return pos - neg;
  }, [dayData]);

  const normalizedProgress = useMemo(() => {
    const N = Math.max(posLen, negLen, 1);
    const pct = ((points - -N) / (N - -N)) * 100;
    return clamp(pct, 0, 100);
  }, [points, posLen, negLen]);

  const monthOptions = useMemo(
    () => [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ],
    []
  );

  const availableYears = useMemo(() => {
    const todayY = new Date().getFullYear();
    const keys = Object.keys(state.days || {});
    const minKey = keys.length ? keys.slice().sort()[0] : toLocalISODate();
    const minY = parseLocalISODate(minKey).getFullYear();
    const out: number[] = [];
    for (let y = minY; y <= todayY; y++) out.push(y);
    return out;
  }, [state.days]);

  const chartData = useMemo(() => {
    const todayStr = toLocalISODate();
    const todayDate = parseLocalISODate(todayStr);

    const dayKeys = Object.keys(state.days || {});
    const minKey = dayKeys.length ? dayKeys.slice().sort()[0] : todayStr;

    let startDate: Date;
    let endDate: Date;

    if (graphRange === "week") {
      startDate = startOfWeekMonday(todayDate);
      endDate = endOfWeekSunday(todayDate);
    } else if (graphRange === "month") {
      startDate = new Date(graphYear, graphMonth, 1);
      endDate = endOfMonth(graphYear, graphMonth);
    } else if (graphRange === "year") {
      startDate = new Date(graphYear, 0, 1);
      endDate = new Date(graphYear, 11, 31);
    } else {
      startDate = parseLocalISODate(minKey);
      endDate = new Date(todayDate);
    }

    const dates: string[] = [];
    for (let d = new Date(startDate); d <= endDate; d = addDays(d, 1)) {
      dates.push(toLocalISODate(d));
    }

    const netFor = (dateStr: string) => {
      const dd = state.days?.[dateStr]
        ? ensureDayShape(state.days[dateStr], posLen, negLen)
        : ensureDayShape(null, posLen, negLen);
      const pos = dd.positive.reduce((acc, v) => acc + (v ? 1 : 0), 0);
      const neg = dd.negative.reduce((acc, v) => acc + (v ? 1 : 0), 0);
      return pos - neg;
    };

    let value = 1;
    const firstDate = dates[0] || todayStr;
    const series: Array<{ date: string; label: string; n: number; value: number; isBaseline: boolean }> = [
      {
        date: firstDate,
        label: formatShortMD(firstDate),
        n: 0,
        value,
        isBaseline: true,
      },
    ];

    for (const dateStr of dates) {
      const n = netFor(dateStr);
      const factor = 1 + RATE_PER_POINT * n;
      value = value * factor;
      series.push({
        date: dateStr,
        label: formatShortMD(dateStr),
        n,
        value,
        isBaseline: false,
      });
    }

    return series;
  }, [state.days, graphRange, graphMonth, graphYear, posLen, negLen]);

  const chartSummary = useMemo(() => {
    const first = chartData?.[0]?.value ?? 1;
    const last = chartData?.[chartData.length - 1]?.value ?? 1;
    const change = last - first;
    const pct = first !== 0 ? (change / first) * 100 : 0;
    return { first, last, change, pct };
  }, [chartData]);

  function ensureDay(dateStr: string) {
    setState((s) => {
      const pLen = s.settings.positive.length;
      const nLen = s.settings.negative.length;
      if (s.days[dateStr]) {
        return {
          ...s,
          days: {
            ...s.days,
            [dateStr]: ensureDayShape(s.days[dateStr], pLen, nLen),
          },
          ui: { ...s.ui, selectedDate: dateStr },
        };
      }
      return {
        ...s,
        days: {
          ...s.days,
          [dateStr]: ensureDayShape(null, pLen, nLen),
        },
        ui: { ...s.ui, selectedDate: dateStr },
      };
    });
  }

  function toggle(kind: "positive" | "negative", idx: number) {
    setState((s) => {
      const pLen = s.settings.positive.length;
      const nLen = s.settings.negative.length;
      const dd = s.days[selectedDate]
        ? ensureDayShape(s.days[selectedDate], pLen, nLen)
        : ensureDayShape(null, pLen, nLen);
      const next: DayState = {
        positive: [...dd.positive],
        negative: [...dd.negative],
      };
      next[kind][idx] = !next[kind][idx];
      return {
        ...s,
        days: {
          ...s.days,
          [selectedDate]: next,
        },
      };
    });
  }

  function resetDay() {
    setState((s) => {
      const pLen = s.settings.positive.length;
      const nLen = s.settings.negative.length;
      return {
        ...s,
        days: {
          ...s.days,
          [selectedDate]: ensureDayShape(null, pLen, nLen),
        },
      };
    });
  }

  function updateHabitLabel(type: "positive" | "negative", index: number, value: string) {
    setState((s) => {
      const nextSettings: SettingsState = {
        ...s.settings,
        [type]: s.settings[type].map((v, i) => (i === index ? value : v)),
      };
      const pLen = nextSettings.positive.length;
      const nLen = nextSettings.negative.length;
      const nextDays: Record<string, DayState> = {};
      for (const [k, v] of Object.entries(s.days)) nextDays[k] = ensureDayShape(v, pLen, nLen);
      return { ...s, settings: nextSettings, days: nextDays };
    });
  }

  function addHabit(type: "positive" | "negative") {
    setState((s) => {
      const baseLabel = type === "positive" ? "New Do item" : "New Do Not item";
      const nextSettings: SettingsState = {
        ...s.settings,
        [type]: insertAtEnd(s.settings[type], baseLabel),
      };

      const pLen = nextSettings.positive.length;
      const nLen = nextSettings.negative.length;
      const nextDays: Record<string, DayState> = {};
      for (const [k, v] of Object.entries(s.days)) {
        nextDays[k] = ensureDayShape(v, pLen, nLen);
      }
      return { ...s, settings: nextSettings, days: nextDays };
    });
  }

  function removeHabit(type: "positive" | "negative", idx: number) {
    setState((s) => {
      if (s.settings[type].length <= 1) return s;

      const nextSettings: SettingsState = {
        ...s.settings,
        [type]: removeAt(s.settings[type], idx),
      };

      const pLen = nextSettings.positive.length;
      const nLen = nextSettings.negative.length;
      const nextDays: Record<string, DayState> = {};

      for (const [k, v] of Object.entries(s.days)) {
        const shaped = ensureDayShape(v, s.settings.positive.length, s.settings.negative.length);
        const nextDay: DayState = {
          positive: shaped.positive,
          negative: shaped.negative,
        };
        if (type === "positive") {
          nextDay.positive = removeAt(nextDay.positive, idx);
        } else {
          nextDay.negative = removeAt(nextDay.negative, idx);
        }
        nextDays[k] = ensureDayShape(nextDay, pLen, nLen);
      }

      return { ...s, settings: nextSettings, days: nextDays };
    });
  }

  function resetHabitLabels() {
    setState((s) => {
      const nextSettings: SettingsState = {
        positive: DEFAULT_POSITIVE,
        negative: DEFAULT_NEGATIVE,
      };
      const pLen = nextSettings.positive.length;
      const nLen = nextSettings.negative.length;
      const nextDays: Record<string, DayState> = {};
      for (const [k, v] of Object.entries(s.days)) nextDays[k] = ensureDayShape(v, pLen, nLen);
      return { ...s, settings: nextSettings, days: nextDays };
    });
  }

  function setGraphRange(nextRange: GraphRange) {
    setState((s) => {
      const now = new Date();
      const nextUi: UIState = { ...s.ui, graphRange: nextRange };
      if (nextRange === "month") {
        nextUi.graphMonth = Number.isInteger(nextUi.graphMonth) ? nextUi.graphMonth : now.getMonth();
        nextUi.graphYear = Number.isInteger(nextUi.graphYear) ? nextUi.graphYear : now.getFullYear();
      }
      if (nextRange === "year") {
        nextUi.graphYear = Number.isInteger(nextUi.graphYear) ? nextUi.graphYear : now.getFullYear();
      }
      return { ...s, ui: nextUi };
    });
  }

  function setGraphMonth(nextMonth: number) {
    setState((s) => ({ ...s, ui: { ...s.ui, graphMonth: clamp(nextMonth, 0, 11) } }));
  }

  function setGraphYear(nextYear: number) {
    setState((s) => ({ ...s, ui: { ...s.ui, graphYear: nextYear } }));
  }

  async function signInWithGoogle() {
    if (!supabase) return;
    setAuthBusy(true);
    try {
      setCloudStatus("Opening Google sign-in...");
      await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          // Uses current origin by default. Make sure this origin is allowed in Supabase.
          redirectTo: typeof window !== "undefined" ? window.location.origin : undefined,
        },
      });
    } finally {
      setAuthBusy(false);
    }
  }

  async function signOut() {
    if (!supabase) return;
    setAuthBusy(true);
    try {
      await supabase.auth.signOut();
      setSession(null);
      setCloudStatus("Signed out. Local-only mode.");
    } finally {
      setAuthBusy(false);
    }
  }

  const today = toLocalISODate();
  const isToday = selectedDate === today;
  const signedIn = Boolean(session?.user);

  return (
    <div className="min-h-screen w-full bg-background">
      <div className="mx-auto max-w-5xl p-4 sm:p-6">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"
        >
          <div>
            <div className="text-2xl font-semibold tracking-tight">Daily Habit Tracker</div>
            <div className="text-sm text-muted-foreground">
              Check "Do" items to add points (+1). Check "Do Not" items to subtract points (-1).
            </div>

<div className="text-xs text-muted-foreground">
  Prod env check: URL={import.meta.env.VITE_SUPABASE_URL ? "SET" : "MISSING"} | KEY={import.meta.env.VITE_SUPABASE_ANON_KEY ? "SET" : "MISSING"}
</div>

            <div className="mt-1 text-xs text-muted-foreground">{cloudStatus}</div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={isToday ? "default" : "secondary"} className="rounded-2xl px-3 py-1">
              {isToday ? "Today" : "Selected"}: {selectedDate}
            </Badge>

            {supabase && (
              <Button
                variant={signedIn ? "outline" : "default"}
                className="rounded-2xl"
                onClick={signedIn ? signOut : signInWithGoogle}
                disabled={authBusy}
                title={signedIn ? "Sign out" : "Sign in with Google"}
              >
                {signedIn ? (
                  <>
                    <LogOut className="mr-2 h-4 w-4" /> Sign out
                  </>
                ) : (
                  <>
                    <LogIn className="mr-2 h-4 w-4" /> Sign in
                  </>
                )}
              </Button>
            )}

            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline" className="rounded-2xl">
                  <Settings className="mr-2 h-4 w-4" /> Customize
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl rounded-2xl">
                <DialogHeader>
                  <DialogTitle>Customize categories</DialogTitle>
                </DialogHeader>

                <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-medium">Do (+1)</div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="rounded-2xl"
                        onClick={() => addHabit("positive")}
                        title="Add a Do item"
                      >
                        <Plus className="mr-2 h-4 w-4" /> Add
                      </Button>
                    </div>

                    {state.settings.positive.map((label, i) => (
                      <div key={`p-${i}`} className="flex items-end gap-2">
                        <div className="flex-1 space-y-1">
                          <Label className="text-xs text-muted-foreground">#{i + 1}</Label>
                          <Input
                            value={label}
                            onChange={(e) => updateHabitLabel("positive", i, e.target.value)}
                            className="rounded-xl"
                            maxLength={60}
                          />
                        </div>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="rounded-2xl"
                          onClick={() => removeHabit("positive", i)}
                          title={state.settings.positive.length <= 1 ? "Keep at least one item" : "Remove"}
                          disabled={state.settings.positive.length <= 1}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-medium">Do Not (-1)</div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="rounded-2xl"
                        onClick={() => addHabit("negative")}
                        title="Add a Do Not item"
                      >
                        <Plus className="mr-2 h-4 w-4" /> Add
                      </Button>
                    </div>

                    {state.settings.negative.map((label, i) => (
                      <div key={`n-${i}`} className="flex items-end gap-2">
                        <div className="flex-1 space-y-1">
                          <Label className="text-xs text-muted-foreground">#{i + 1}</Label>
                          <Input
                            value={label}
                            onChange={(e) => updateHabitLabel("negative", i, e.target.value)}
                            className="rounded-xl"
                            maxLength={60}
                          />
                        </div>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="rounded-2xl"
                          onClick={() => removeHabit("negative", i)}
                          title={state.settings.negative.length <= 1 ? "Keep at least one item" : "Remove"}
                          disabled={state.settings.negative.length <= 1}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>

                <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-between">
                  <Button variant="ghost" onClick={resetHabitLabels} className="rounded-2xl">
                    <RotateCcw className="mr-2 h-4 w-4" /> Reset labels
                  </Button>
                  <Button variant="outline" className="rounded-2xl">
                    Done
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </motion.div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <Card className="lg:col-span-4 rounded-2xl shadow-sm">
            <CardContent className="p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">Points</div>
                <Badge variant={points >= 0 ? "default" : "destructive"} className="rounded-2xl">
                  {points >= 0 ? `+${points}` : points}
                </Badge>
              </div>

              <div className="space-y-2">
                <div className="text-xs text-muted-foreground">Daily balance</div>
                <Progress value={normalizedProgress} className="h-2 rounded-full" />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>-{Math.max(posLen, negLen, 1)}</span>
                  <span>0</span>
                  <span>+{Math.max(posLen, negLen, 1)}</span>
                </div>
              </div>

              <Separator />

              <div className="space-y-2">
                <div className="text-sm font-medium">Date</div>
                <Input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => ensureDay(e.target.value)}
                  className="rounded-xl"
                />
              </div>

              <Separator />

              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={resetDay} className="rounded-2xl">
                  <RotateCcw className="mr-2 h-4 w-4" /> Reset day
                </Button>
              </div>

              <div className="text-xs text-muted-foreground">Data is stored locally in your browser (localStorage). Cloud sync is optional.</div>
            </CardContent>
          </Card>

          <Card className="lg:col-span-8 rounded-2xl shadow-sm">
            <CardContent className="p-5">
              <div className="space-y-6">
                <HabitSection
                  title="Do"
                  subtitle="Checked items add 1 point"
                  variant="positive"
                  labels={state.settings.positive}
                  checks={dayData.positive}
                  onToggle={(i) => toggle("positive", i)}
                />

                <HabitSection
                  title="Do Not"
                  subtitle="Checked items subtract 1 point"
                  variant="negative"
                  labels={state.settings.negative}
                  checks={dayData.negative}
                  onToggle={(i) => toggle("negative", i)}
                />
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="mt-4 rounded-2xl shadow-sm">
          <CardContent className="p-5 space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 rounded-2xl border p-2">
                  <TrendingUp className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-lg font-semibold">Cumulative Progress</div>
                  <div className="text-sm text-muted-foreground">
                    Starts at 1, then applies each day’s multiplier: value = value × (1 + {String(RATE_PER_POINT)} × n).
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant={graphRange === "week" ? "default" : "outline"}
                  className="rounded-2xl"
                  onClick={() => setGraphRange("week")}
                >
                  Week
                </Button>
                <Button
                  size="sm"
                  variant={graphRange === "month" ? "default" : "outline"}
                  className="rounded-2xl"
                  onClick={() => setGraphRange("month")}
                >
                  Month
                </Button>
                <Button
                  size="sm"
                  variant={graphRange === "year" ? "default" : "outline"}
                  className="rounded-2xl"
                  onClick={() => setGraphRange("year")}
                >
                  Year
                </Button>
                <Button
                  size="sm"
                  variant={graphRange === "all" ? "default" : "outline"}
                  className="rounded-2xl"
                  onClick={() => setGraphRange("all")}
                >
                  All time
                </Button>

                {graphRange === "month" && (
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={graphMonth}
                      onChange={(e) => setGraphMonth(Number(e.target.value))}
                      className="h-9 rounded-2xl border bg-background px-3 text-sm"
                    >
                      {monthOptions.map((m, i) => (
                        <option key={m} value={i}>
                          {m}
                        </option>
                      ))}
                    </select>
                    <select
                      value={graphYear}
                      onChange={(e) => setGraphYear(Number(e.target.value))}
                      className="h-9 rounded-2xl border bg-background px-3 text-sm"
                    >
                      {availableYears.map((y) => (
                        <option key={y} value={y}>
                          {y}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {graphRange === "year" && (
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={graphYear}
                      onChange={(e) => setGraphYear(Number(e.target.value))}
                      className="h-9 rounded-2xl border bg-background px-3 text-sm"
                    >
                      {availableYears.map((y) => (
                        <option key={y} value={y}>
                          {y}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Badge variant="outline" className="rounded-2xl">
                Start: {chartSummary.first.toFixed(4)}
              </Badge>
              <Badge
                variant={chartSummary.last >= chartSummary.first ? "default" : "destructive"}
                className="rounded-2xl"
              >
                End: {chartSummary.last.toFixed(4)}
              </Badge>
              <Badge variant="secondary" className="rounded-2xl">
                Δ {chartSummary.change >= 0 ? "+" : ""}
                {chartSummary.change.toFixed(4)}
              </Badge>
              <Badge variant="secondary" className="rounded-2xl">
                {chartSummary.pct >= 0 ? "+" : ""}
                {chartSummary.pct.toFixed(2)}%
              </Badge>
            </div>

            <div className="h-72 w-full text-foreground">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 8, right: 14, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={12} />
                  <YAxis tickLine={false} axisLine={false} width={44} domain={["auto", "auto"]} />
                  <Tooltip content={<ChartTooltip />} />
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke="currentColor"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="text-xs text-muted-foreground">
              n is your daily net points (Do minus Do Not). Missing days count as n = 0.
            </div>
          </CardContent>
        </Card>

        <div className="mt-6 text-xs text-muted-foreground">
          Tip: Add/remove items from the Customize dialog. Each day is tracked separately.
        </div>
      </div>
    </div>
  );
}

function HabitSection(props: {
  title: string;
  subtitle: string;
  variant: "positive" | "negative";
  labels: string[];
  checks: boolean[];
  onToggle: (idx: number) => void;
}) {
  const { title, subtitle, variant, labels, checks, onToggle } = props;
  const isPositive = variant === "positive";

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-lg font-semibold">{title}</div>
          <div className="text-sm text-muted-foreground">{subtitle}</div>
        </div>
        <Badge variant={isPositive ? "default" : "secondary"} className="rounded-2xl">
          {isPositive ? "+1 each" : "-1 each"}
        </Badge>
      </div>

      <div className="grid grid-cols-1 gap-2">
        {labels.map((label, i) => (
          <motion.div
            key={`${variant}-${i}`}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18, delay: i * 0.02 }}
            className="flex items-center justify-between rounded-2xl border p-3"
          >
            <div className="flex items-center gap-3">
              <Checkbox
                checked={Boolean(checks[i])}
                onCheckedChange={() => onToggle(i)}
                id={`${variant}-${i}`}
              />
              <Label htmlFor={`${variant}-${i}`} className="cursor-pointer">
                {label}
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="rounded-2xl">
                {checks[i] ? (isPositive ? "+1" : "-1") : "0"}
              </Badge>
            </div>
          </motion.div>
        ))}
      </div>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Plus className="h-3.5 w-3.5" />
        {isPositive ? "Check completed Do items to earn points." : "Check Do Not items to deduct points."}
      </div>
    </div>
  );
}

function ChartTooltip({ active, payload }: { active?: boolean; payload?: any[] }) {
  if (!active || !payload || !payload.length) return null;
  const p = payload[0]?.payload;
  if (!p) return null;

  const isBaseline = Boolean(p.isBaseline);
  return (
    <div className="rounded-2xl border bg-background p-3 shadow-sm">
      <div className="text-sm font-medium">{p.date}</div>
      <div className="mt-1 text-xs text-muted-foreground">
        {isBaseline ? "Baseline (start = 1)" : `n = ${p.n >= 0 ? "+" : ""}${p.n}`}
      </div>
      <div className="mt-2 text-sm">
        Value: <span className="font-medium">{Number(p.value).toFixed(4)}</span>
      </div>
    </div>
  );
}

// --- Minimal internal tests (dev-only) ---
function runDevTests() {
  const assert = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`Test failed: ${msg}`);
  };

  // Week start/end sanity: 2026-01-19 is a Monday.
  const d = parseLocalISODate("2026-01-19");
  const wStart = startOfWeekMonday(d);
  const wEnd = endOfWeekSunday(d);
  assert(toLocalISODate(wStart) === "2026-01-19", "Week should start on Monday");
  assert(toLocalISODate(wEnd) === "2026-01-25", "Week should end on Sunday");

  // Month end sanity: Feb 2024 is leap year.
  const febEnd = endOfMonth(2024, 1);
  assert(toLocalISODate(febEnd) === "2024-02-29", "Leap-year February should end on 29th");

  // Growth formula: start 1, n=+2 => 1*(1+0.01*2)=1.02
  const v = 1 * (1 + RATE_PER_POINT * 2);
  assert(Math.abs(v - 1.02) < 1e-9, "Growth formula should apply RATE_PER_POINT correctly");

  // Removing habit removes that checkbox across days
  const sample: DayState = { positive: [true, false, true], negative: [false, true] };
  const removedPos = removeAt(sample.positive, 1);
  assert(
    removedPos.length === 2 && removedPos[0] === true && removedPos[1] === true,
    "removeAt should remove correct index"
  );
}

if (import.meta.env.DEV) {
  try {
    runDevTests();
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(e);
  }
}
