import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { Building2, Loader2, MapPin, ArrowRight } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

interface DBOffice {
  id: string;
  name: string;
  city: string;
  country: string;
}

const DEFAULT_OFFICES: DBOffice[] = [
  { id: "off-001", name: "Bengaluru Corporate Office", city: "Bengaluru", country: "India" },
  { id: "off-002", name: "Mumbai Manufacturing Hub", city: "Mumbai", country: "India" },
  { id: "off-003", name: "Hyderabad R&D Center", city: "Hyderabad", country: "India" },
  { id: "off-004", name: "Chennai Operations Site", city: "Chennai", country: "India" },
];

const OfficeSelection = () => {
  const navigate = useNavigate();
  const { employee, setOfficeState, isAuthenticated } = useAuth();
  const [offices, setOffices] = useState<DBOffice[]>(DEFAULT_OFFICES);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updating, setUpdating] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated) {
      navigate("/login");
      return;
    }

    const fetchOffices = async () => {
      try {
        setLoading(true);
        const { data, error: dbError } = await supabase
          .from("offices" as never)
          .select("id, name, city, country");

        if (!dbError && data && (data as DBOffice[]).length > 0) {
          setOffices(data as DBOffice[]);
        } else {
          setOffices(DEFAULT_OFFICES);
        }
      } catch (err: unknown) {
        console.warn("Notice loading offices (using default locations):", err);
        setOffices(DEFAULT_OFFICES);
      } finally {
        setLoading(false);
      }
    };

    fetchOffices();
  }, [isAuthenticated, navigate]);

  const handleSelect = async (office: DBOffice) => {
    if (!employee) return;
    
    try {
      setUpdating(office.id);
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase
          .from("profiles" as unknown as "profiles")
          .update({ office_id: office.id })
          .eq("id", user.id);
      }
    } catch (err: unknown) {
      console.warn("Notice updating profile office assignment:", err);
    } finally {
      setOfficeState({
        id: office.id,
        name: office.name,
        short: office.name.split(" ")[0],
      });
      navigate("/analysis");
      setUpdating(null);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 section-padding bg-background py-12">
        <div className="container-max">
          <div className="max-w-3xl mx-auto text-center">
            {/* Header */}
            <div className="mb-10">
              <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 border border-primary/20 px-4 py-1.5 mb-5">
                <Building2 className="h-3.5 w-3.5 text-primary" />
                <span className="text-xs font-semibold text-primary uppercase tracking-wide">Check-In</span>
              </div>
              <h1 className="text-2xl sm:text-3xl lg:text-4xl font-heading font-bold text-foreground mb-3">
                Select Your Office
              </h1>
              <p className="text-muted-foreground max-w-md mx-auto">
                Choose your facility below to begin your workplace analysis check-in.
              </p>
            </div>

            {/* Error banner */}
            {error && (
              <div className="p-4 mb-8 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg">
                {error}
              </div>
            )}

            {/* Office Grid */}
            {loading ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <Loader2 className="h-8 w-8 text-primary animate-spin" />
                <p className="text-sm text-muted-foreground">Loading facilities...</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-left">
                {offices.map((off) => (
                  <button
                    key={off.id}
                    onClick={() => handleSelect(off)}
                    disabled={updating !== null}
                    className="group relative flex flex-col justify-between p-6 rounded-xl border border-border bg-card hover:border-primary/50 hover:shadow-md transition-all text-left disabled:opacity-50"
                  >
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold text-primary uppercase tracking-wider bg-primary/10 px-2.5 py-1 rounded-md">
                          Facility
                        </span>
                        {updating === off.id ? (
                          <Loader2 className="h-4 w-4 animate-spin text-primary" />
                        ) : (
                          <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all" />
                        )}
                      </div>
                      <h3 className="text-lg font-semibold text-foreground group-hover:text-primary transition-colors">
                        {off.name}
                      </h3>
                      <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1.5">
                        <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                        {off.city}{off.country ? `, ${off.country}` : ''}
                      </p>
                    </div>

                    <div className="mt-6 pt-4 border-t border-border/50 flex items-center justify-between text-xs text-muted-foreground">
                      <span>Operational Hub</span>
                      <span className="font-medium text-primary group-hover:underline">Select & Continue &rarr;</span>
                    </div>
                  </button>
                ))}
              </div>
            )}

            <p className="text-xs text-muted-foreground mt-8">
              Your selection will be recorded with your analysis for audit purposes.
            </p>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default OfficeSelection;
