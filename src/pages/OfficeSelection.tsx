import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { Building2, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

interface DBOffice {
  id: string;
  name: string;
  city: string;
  country: string;
}

const OfficeSelection = () => {
  const navigate = useNavigate();
  const { employee, setOfficeState, isAuthenticated } = useAuth();
  const [offices, setOffices] = useState<DBOffice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updating, setUpdating] = useState<string | null>(null);

  useEffect(() => {
    // RLS requires authentication to fetch offices
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

        if (dbError) throw dbError;
        setOffices((data as DBOffice[]) || []);
      } catch (err: unknown) {
        console.error("Failed to fetch offices:", err);
        setError("Unable to load offices. Please ensure you are authenticated.");
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
      if (!user) throw new Error("No authenticated user session found");

      // Save to public.profiles database table
      const { error: updateError } = await supabase
        .from("profiles" as unknown as "profiles")
        .update({ office_id: office.id })
        .eq("id", user.id);

      if (updateError) throw updateError;

      // Update state in AuthContext (saves to sessionStorage and updates React state)
      setOfficeState({
        id: office.id,
        name: office.name,
        short: office.name.split(" ")[0],
      });

      navigate("/analysis");
    } catch (err: unknown) {
      console.error("Failed to persist office selection:", err);
      setError("Failed to save office selection. Please try again.");
    } finally {
      setUpdating(null);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 section-padding bg-background">
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

            {error && (
              <div className="mb-6 rounded-md bg-destructive/10 border border-destructive/20 px-4 py-3 max-w-md mx-auto">
                <p className="text-sm text-destructive font-medium">{error}</p>
              </div>
            )}

            {/* Office Cards */}
            {loading ? (
              <div className="flex flex-col items-center justify-center py-12">
                <Loader2 className="h-8 w-8 text-primary animate-spin" />
                <p className="text-sm text-muted-foreground mt-2">Loading facility options...</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
                {offices.map((office) => (
                  <button
                    key={office.id}
                    disabled={updating !== null}
                    onClick={() => handleSelect(office)}
                    className="group flex flex-col items-center gap-5 bg-card border-2 border-border hover:border-primary/50 rounded-2xl p-6 sm:p-8 transition-all duration-200 hover:shadow-lg hover:-translate-y-1 text-left w-full cursor-pointer disabled:opacity-50"
                  >
                    {/* Logo placeholder with initial */}
                    <div className="w-20 h-20 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center group-hover:bg-primary/20 transition-colors flex-shrink-0">
                      {updating === office.id ? (
                        <Loader2 className="h-8 w-8 text-primary animate-spin" />
                      ) : (
                        <span className="text-2xl font-heading font-extrabold text-primary">
                          {office.name.charAt(0)}
                        </span>
                      )}
                    </div>

                    <div className="space-y-2 flex-1 text-center">
                      <p className="text-sm font-heading font-bold text-foreground leading-snug">
                        {office.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {office.city}, {office.country}
                      </p>
                      <div className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 mt-2">
                        <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                        <span className="text-xs font-semibold text-primary">Check In</span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}

            <p className="mt-8 text-xs text-muted-foreground">
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

