import { useState, useEffect } from "react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { supabase } from "@/integrations/supabase/client";
import { History as HistoryIcon, Search, Calendar, User, Building2, TrendingUp, ChevronDown, ChevronUp } from "lucide-react";

interface AnalysisLog {
  id: string;
  employee_name: string;
  employee_id: string;
  department: string;
  analysis_date: string;
  analysis_result: Record<string, unknown>;
  before_image: string | null;
  after_image: string | null;
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

const HistoryRow = ({ log }: { log: AnalysisLog }) => {
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
            const { data } = await supabase
        .from("analysis_logs")
        .select("before_image, after_image, before_image_path, after_image_path")
        .eq("id", log.id)
        .single();
      if (data) {
        let beforeUrl = data.before_image_path || data.before_image;
        let afterUrl = data.after_image_path || data.after_image;

        // Check if image paths are stored as relative private paths inside '5s-images' bucket
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

        setImages({ before_image: beforeUrl, after_image: afterUrl });
      }
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
            <span className="text-xs text-muted-foreground">({log.employee_id})</span>
          </div>
          <div className="flex items-center gap-2">
            <Building2 className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
            <span className="text-xs text-muted-foreground">{log.department}</span>
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
        </div>
      )}
    </div>
  );
};

const History = () => {
  const [logs, setLogs] = useState<AnalysisLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [dateFilter, setDateFilter] = useState("");

  useEffect(() => {
    const handler = setTimeout(() => {
      const fetchLogs = async () => {
        setLoading(true);
        let query = supabase
          .from("analysis_logs")
          .select("id, employee_name, employee_id, department, analysis_date, analysis_result")
          .order("analysis_date", { ascending: false })
          .limit(100);

        if (search.trim()) {
          const s = search.trim();
          query = query.or(`employee_name.ilike.%${s}%,employee_id.ilike.%${s}%,department.ilike.%${s}%`);
        }

        if (dateFilter) {
          const [year, month, day] = dateFilter.split("-").map(Number);
          const startOfDay = new Date(year, month - 1, day, 0, 0, 0, 0);
          const endOfDay = new Date(year, month - 1, day, 23, 59, 59, 999);
          
          query = query
            .gte("analysis_date", startOfDay.toISOString())
            .lte("analysis_date", endOfDay.toISOString());
        }

        const { data, error } = await query;
        if (!error && data) {
          setLogs(data as AnalysisLog[]);
        }
        setLoading(false);
      };
      fetchLogs();
    }, 300);

    return () => clearTimeout(handler);
  }, [search, dateFilter]);

  const filtered = logs;

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 section-padding bg-background">
        <div className="container-max">
          <div className="max-w-4xl mx-auto">
            {/* Header */}
            <div className="flex items-center gap-3 mb-8">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <HistoryIcon className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h1 className="text-2xl sm:text-3xl font-heading font-bold text-foreground">Analysis History</h1>
                <p className="text-sm text-muted-foreground">Past 5S analysis records and results</p>
              </div>
            </div>

            {/* Filters */}
            <div className="flex flex-col sm:flex-row gap-3 mb-6">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search by name, ID, or department..."
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
              {loading ? "Loading..." : `${filtered.length} record${filtered.length !== 1 ? "s" : ""} found`}
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
            ) : filtered.length === 0 ? (
              <div className="text-center py-16">
                <HistoryIcon className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">No records found</p>
                {search || dateFilter ? (
                  <p className="text-xs text-muted-foreground mt-1">Try adjusting your filters</p>
                ) : (
                  <p className="text-xs text-muted-foreground mt-1">Run an analysis to see records here</p>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {filtered.map((log) => (
                  <HistoryRow key={log.id} log={log} />
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
