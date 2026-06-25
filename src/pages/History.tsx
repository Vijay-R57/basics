import { useState, useEffect } from "react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  History as HistoryIcon,
  Search,
  Calendar,
  User,
  Building2,
  TrendingUp,
  ChevronDown,
  ChevronUp,
  Shield,
  Lock,
} from "lucide-react";

interface AnalysisLog {
  id: string;
  employee_name: string;
  employee_id: string;
  department: string;
  office_name: string | null;
  analysis_date: string;
  analysis_result: Record<string, unknown>;
  before_image_path: string | null;
  after_image_path: string | null;
  scoring_method: string | null;
  overall_score_before: number | null;
  overall_score_after: number | null;
}

const ScoreBadge = ({ score }: { score: number }) => {
  const color =
    score >= 80
      ? "bg-primary/10 text-primary border-primary/20"
      : score >= 60
        ? "bg-warning/10 text-warning border-warning/20"
        : "bg-destructive/10 text-destructive border-destructive/20";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-bold border ${color}`}>
      {score}%
    </span>
  );
};

const HistoryRow = ({ log, isAdmin }: { log: AnalysisLog; isAdmin: boolean }) => {
  const [expanded, setExpanded] = useState(false);
  const [images, setImages] = useState<{ before_image: string | null; after_image: string | null } | null>(null);
  const [imgLoading, setImgLoading] = useState(false);
  const result = log.analysis_result;
  const avgBefore = result?.beforeScores
    ? Math.round(Object.values(result.beforeScores as Record<string, number>).reduce((a, b) => a + b, 0) / 5)
    : null;
  const avgAfter = result?.afterScores
    ? Math.round(Object.values(result.afterScores as Record<string, number>).reduce((a, b) => a + b, 0) / 5)
    : null;

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) +
      " " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  };

  const handleToggle = async () => {
    const willExpand = !expanded;
    setExpanded(willExpand);
    if (willExpand && !images && !imgLoading) {
      setImgLoading(true);

      // Use preloaded storage paths first (modern records use these)
      let beforeUrl: string | null = log.before_image_path;
      let afterUrl: string | null = log.after_image_path;

      // Fall back to a targeted single-record fetch for older records
      if (!beforeUrl && !afterUrl) {
        const { data } = await supabase
          .from("analysis_logs")
          .select("before_image, after_image, before_image_path, after_image_path")
          .eq("id", log.id)
          .single();
        if (data) {
          beforeUrl = data.before_image_path || data.before_image;
          afterUrl = data.after_image_path || data.after_image;
        }
      }

      // Resolve private storage paths to 1-hour signed URLs
      if (beforeUrl && !beforeUrl.startsWith("data:") && !beforeUrl.startsWith("http")) {
        const { data: bData } = await supabase.storage
          .from("5s-images")
          .createSignedUrl(beforeUrl, 3600);
        if (bData) beforeUrl = bData.signedUrl;
      }

      if (afterUrl && !afterUrl.startsWith("data:") && !afterUrl.startsWith("http")) {
        const { data: aData } = await supabase.storage
          .from("5s-images")
          .createSignedUrl(afterUrl, 3600);
        if (aData) afterUrl = aData.signedUrl;
      }

      setImages({ before_image: beforeUrl ?? null, after_image: afterUrl ?? null });
      setImgLoading(false);
    }
  };

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div
        className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 cursor-pointer hover:bg-muted/30 transition-colors"
        onClick={handleToggle}
      >
        {/* Employee info */}
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <User className="h-3.5 w-3.5 text-primary flex-shrink-0" />
            <span className="text-sm font-semibold text-foreground truncate">{log.employee_name}</span>
            {/* Only show employee ID to admins/supervisors */}
            {isAdmin && (
              <span className="text-xs text-muted-foreground">({log.employee_id})</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Building2 className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
            <span className="text-xs text-muted-foreground">{log.department}</span>
            {log.office_name && (
              <span className="text-xs text-muted-foreground/70">· {log.office_name}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Calendar className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
            <span className="text-xs text-muted-foreground">{formatDate(log.analysis_date)}</span>
          </div>
        </div>

        {/* Scores */}
        {avgBefore !== null && avgAfter !== null && (
          <div className="flex items-center gap-2 flex-shrink-0">
            <div className="text-center">
              <p className="text-xs text-muted-foreground mb-1">Before</p>
              <ScoreBadge score={avgBefore} />
            </div>
            <TrendingUp className="h-4 w-4 text-primary" />
            <div className="text-center">
              <p className="text-xs text-muted-foreground mb-1">After</p>
              <ScoreBadge score={avgAfter} />
            </div>
          </div>
        )}

        <div className="flex-shrink-0">
          {expanded ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="border-t border-border p-4 space-y-4 bg-muted/20">
          {/* Images - lazy loaded */}
          {imgLoading ? (
            <div className="grid grid-cols-2 gap-3">
              {[1, 2].map((i) => (
                <div key={i} className="h-32 bg-muted rounded-lg animate-pulse" />
              ))}
            </div>
          ) : images && (images.before_image || images.after_image) ? (
            <div className="grid grid-cols-2 gap-3">
              {images.before_image && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-1 uppercase tracking-wide">Before</p>
                  <img src={images.before_image} alt="Before" className="w-full h-32 object-cover rounded-lg border border-border" loading="lazy" />
                </div>
              )}
              {images.after_image && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-1 uppercase tracking-wide">After</p>
                  <img src={images.after_image} alt="After" className="w-full h-32 object-cover rounded-lg border border-border" loading="lazy" />
                </div>
              )}
            </div>
          ) : null}

          {/* Overview */}
          {result?.overview && (
            <div>
              <p className="text-xs font-semibold text-foreground mb-1">Overview</p>
              <p className="text-xs text-muted-foreground leading-relaxed">{result.overview as string}</p>
            </div>
          )}

          {/* 5S Scores breakdown */}
          {result?.afterScores && (
            <div>
              <p className="text-xs font-semibold text-foreground mb-2">5S Scores (After)</p>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                {Object.entries(result.afterScores as Record<string, number>).map(([key, val]) => (
                  <div key={key} className="text-center bg-card rounded-lg border border-border p-2">
                    <p className="text-xs text-muted-foreground capitalize mb-1">{key === "setInOrder" ? "Set in Order" : key}</p>
                    <ScoreBadge score={val} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Lean maintenance */}
          {result?.leanMaintenanceScore !== undefined && (
            <div className="flex items-center gap-3 bg-card rounded-lg border border-border p-3">
              <TrendingUp className="h-4 w-4 text-primary flex-shrink-0" />
              <div>
                <p className="text-xs font-semibold text-foreground">Lean Maintenance Score</p>
                <p className="text-xs text-muted-foreground">{result.leanMaintenanceScore as number}%</p>
              </div>
            </div>
          )}

          {/* Scoring method badge */}
          {log.scoring_method && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Scored by:</span>
              <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-primary/10 text-primary border border-primary/20">
                {log.scoring_method}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ── Role badge shown in the page header ──────────────────────────────────────
const RoleBadge = ({ role }: { role: string }) => {
  const isAdmin = role === "admin" || role === "supervisor";
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border ${
      isAdmin
        ? "bg-primary/10 text-primary border-primary/20"
        : "bg-muted text-muted-foreground border-border"
    }`}>
      {isAdmin ? <Shield className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
      {role === "admin" ? "Admin" : role === "supervisor" ? "Supervisor" : "Worker"}
    </span>
  );
};

// ── Main History Component ────────────────────────────────────────────────────
const History = () => {
  const { employee } = useAuth();
  const role = employee?.role ?? "worker";
  const isAdmin = role === "admin" || role === "supervisor";

  const [logs, setLogs] = useState<AnalysisLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    const handler = setTimeout(() => {
      const fetchLogs = async () => {
        setLoading(true);
        setError(null);

        let query = supabase
          .from("analysis_logs")
          .select("id, employee_name, employee_id, department, office_name, analysis_date, analysis_result, before_image_path, after_image_path, scoring_method, overall_score_before, overall_score_after")
          .order("analysis_date", { ascending: false })
          .limit(isAdmin ? 500 : 100);

        // ── Role-based filtering ─────────────────────────────────────────────
        // Workers see only their own records — filter by their employee ID
        if (!isAdmin && employee?.employeeId) {
          query = query.eq("employee_id", employee.employeeId);
        }

        // ── Search filter ────────────────────────────────────────────────────
        if (search.trim()) {
          const s = search.trim();
          if (isAdmin) {
            // Admins can search across all fields including other employees
            query = query.or(`employee_name.ilike.%${s}%,employee_id.ilike.%${s}%,department.ilike.%${s}%,office_name.ilike.%${s}%`);
          } else {
            // Workers search within their own records (department, date context)
            query = query.or(`department.ilike.%${s}%,office_name.ilike.%${s}%`);
          }
        }

        // ── Date filter ──────────────────────────────────────────────────────
        if (dateFilter) {
          const [year, month, day] = dateFilter.split("-").map(Number);
          const startOfDay = new Date(year, month - 1, day, 0, 0, 0, 0);
          const endOfDay = new Date(year, month - 1, day, 23, 59, 59, 999);
          query = query
            .gte("analysis_date", startOfDay.toISOString())
            .lte("analysis_date", endOfDay.toISOString());
        }

        const { data, error: queryError } = await query;
        if (queryError) {
          console.error("History fetch error:", queryError);
          setError(queryError.message || "Failed to load analysis history.");
        } else if (data) {
          setLogs(data as AnalysisLog[]);
        }
        setLoading(false);
      };
      fetchLogs();
    }, 300);

    return () => clearTimeout(handler);
  }, [search, dateFilter, retryKey, isAdmin, employee?.employeeId]);

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 section-padding bg-background">
        <div className="container-max">
          <div className="max-w-4xl mx-auto">

            {/* Header */}
            <div className="flex items-start justify-between gap-3 mb-8">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                  <HistoryIcon className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h1 className="text-2xl sm:text-3xl font-heading font-bold text-foreground">Analysis History</h1>
                  <p className="text-sm text-muted-foreground">
                    {isAdmin
                      ? "All 5S analysis records across all employees"
                      : "Your personal 5S analysis records and results"}
                  </p>
                </div>
              </div>
              {/* Role badge */}
              <div className="flex flex-col items-end gap-1 flex-shrink-0">
                <RoleBadge role={role} />
                {employee && (
                  <p className="text-xs text-muted-foreground">{employee.name}</p>
                )}
              </div>
            </div>

            {/* Role info banner */}
            {!isAdmin && (
              <div className="flex items-center gap-2 bg-muted/50 border border-border rounded-lg px-4 py-2.5 mb-6">
                <Lock className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <p className="text-xs text-muted-foreground">
                  Showing only <span className="font-semibold text-foreground">your own</span> analysis records.
                  Contact a supervisor to view team-wide history.
                </p>
              </div>
            )}

            {isAdmin && (
              <div className="flex items-center gap-2 bg-primary/5 border border-primary/20 rounded-lg px-4 py-2.5 mb-6">
                <Shield className="h-4 w-4 text-primary flex-shrink-0" />
                <p className="text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">Admin view:</span> Showing all employee records across all departments.
                </p>
              </div>
            )}

            {/* Filters */}
            <div className="flex flex-col sm:flex-row gap-3 mb-6">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder={
                    isAdmin
                      ? "Search by name, ID, department, or office..."
                      : "Search by department or office..."
                  }
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-9 pr-4 py-2.5 rounded-lg border border-border bg-card text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <input
                  type="date"
                  value={dateFilter}
                  onChange={(e) => setDateFilter(e.target.value)}
                  className="px-3 py-2.5 rounded-lg border border-border bg-card text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
                {dateFilter && (
                  <button
                    onClick={() => setDateFilter("")}
                    className="text-xs text-primary hover:underline"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            {/* Results count */}
            <p className="text-xs text-muted-foreground mb-4">
              {loading
                ? "Loading..."
                : error
                  ? "Failed to load records"
                  : `${logs.length} record${logs.length !== 1 ? "s" : ""} found`}
            </p>

            {/* List */}
            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="bg-card border border-border rounded-xl p-4 animate-pulse">
                    <div className="h-4 bg-muted rounded w-1/3 mb-2" />
                    <div className="h-3 bg-muted rounded w-1/4" />
                  </div>
                ))}
              </div>
            ) : error ? (
              <div className="text-center py-16">
                <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center mx-auto mb-3">
                  <HistoryIcon className="h-6 w-6 text-destructive" />
                </div>
                <p className="text-sm font-semibold text-foreground mb-1">Failed to load history</p>
                <p className="text-xs text-muted-foreground mb-4 max-w-xs mx-auto">{error}</p>
                <button
                  onClick={() => setRetryKey(k => k + 1)}
                  className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
                >
                  Retry
                </button>
              </div>
            ) : logs.length === 0 ? (
              <div className="text-center py-16">
                <HistoryIcon className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">No records found</p>
                {search || dateFilter ? (
                  <p className="text-xs text-muted-foreground mt-1">Try adjusting your filters</p>
                ) : (
                  <p className="text-xs text-muted-foreground mt-1">
                    {isAdmin ? "No analyses have been recorded yet" : "Run an analysis to see your records here"}
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {logs.map((log) => (
                  <HistoryRow key={log.id} log={log} isAdmin={isAdmin} />
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default History;
