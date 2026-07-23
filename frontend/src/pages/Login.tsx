import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { Loader2, LogIn, Eye, EyeOff } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import logo from "@/assets/logo.png";

const Login = () => {
  const [employeeId, setEmployeeId] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const cleanEmpId = employeeId.trim();
    const cleanPassword = password.trim();

    if (!cleanEmpId || !cleanPassword) {
      setError("Please enter both Employee ID and Password");
      return;
    }

    if (cleanPassword.length < 6) {
      setError("Password must be at least 6 characters long.");
      return;
    }

    setLoading(true);
    try {
      const formattedEmail = cleanEmpId.includes("@")
        ? cleanEmpId
        : `${cleanEmpId.toLowerCase()}@arcolab.com`;

      // 1. Authenticate with Supabase Auth
      let authResult = await supabase.auth.signInWithPassword({
        email: formattedEmail,
        password: cleanPassword,
      });

      // 2. If Auth account does not exist yet in Supabase Auth, register automatically
      if (authResult.error && authResult.error.message?.toLowerCase().includes("invalid login credentials")) {
        const signUpResult = await supabase.auth.signUp({
          email: formattedEmail,
          password: cleanPassword,
          options: {
            data: {
              employee_code: cleanEmpId.toUpperCase(),
              first_name: cleanEmpId,
              role: "admin",
            },
          },
        });

        if (!signUpResult.error && signUpResult.data?.session) {
          authResult = { data: signUpResult.data, error: null } as any;
        } else if (!signUpResult.error && signUpResult.data?.user && !signUpResult.data?.session) {
          setError(`Account created for ${formattedEmail}. Please check your inbox to confirm your account before logging in.`);
          setLoading(false);
          return;
        } else if (signUpResult.error) {
          authResult.error = signUpResult.error;
        }
      }

      if (authResult.error) {
        const msg = authResult.error.message || "Invalid Employee ID or Password";
        if (msg.toLowerCase().includes("email not confirmed")) {
          setError(`Email not confirmed for ${formattedEmail}. Please check your inbox to confirm your account.`);
          setLoading(false);
          return;
        }
        throw new Error(msg);
      }

      const user = authResult.data.user;
      const session = authResult.data.session;

      if (!user || !session) {
        throw new Error("Unable to establish Supabase session.");
      }

      // 3. Fetch user profile from public.profiles table in Supabase DB
      const { data: profileData } = await supabase
        .from("profiles" as never)
        .select("first_name, last_name, role, employee_code, office_id")
        .eq("id", user.id)
        .maybeSingle();

      const profile = profileData as {
        first_name?: string | null;
        last_name?: string | null;
        role?: string;
        employee_code?: string | null;
        office_id?: string | null;
      } | null;

      const employeeObj = {
        employeeId: profile?.employee_code || cleanEmpId.toUpperCase(),
        name: profile && (profile.first_name || profile.last_name)
          ? `${profile.first_name || ""} ${profile.last_name || ""}`.trim()
          : cleanEmpId.toUpperCase(),
        department: "Operational Excellence",
        role: profile?.role || "admin",
        office_id: profile?.office_id || null,
      };

      // 4. Set authentic session in AuthContext & Supabase Client
      await login(employeeObj, session);

      if (employeeObj.office_id) {
        navigate("/5s-audit");
      } else {
        navigate("/select-office");
      }
      return;
    } catch (err: unknown) {
      let errMsg = "Invalid Employee ID or Password";
      if (err instanceof Error && err.message) {
        errMsg = err.message;
      } else if (typeof err === "string") {
        errMsg = err;
      } else if (err && typeof err === "object" && "message" in err) {
        errMsg = String((err as any).message);
      }
      
      console.error("Supabase Login Error:", errMsg);

      if (errMsg.toLowerCase().includes("invalid login credentials")) {
        errMsg = "Invalid Employee ID or Password. Please check your credentials.";
      }
      setError(errMsg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 flex items-center justify-center section-padding bg-background">
        <div className="w-full max-w-md">
          <div className="bg-card rounded-xl border border-border p-8 shadow-sm">
            <div className="flex flex-col items-center mb-8">
              <img src={logo} alt="ArcoLabs" className="h-14 w-auto mb-4" />
              <h1 className="text-2xl font-heading font-bold text-foreground">Employee Login</h1>
              <p className="text-sm text-muted-foreground mt-1">Sign in to access 5S Analysis</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Employee ID</label>
                <input
                  type="text"
                  value={employeeId}
                  onChange={(e) => setEmployeeId(e.target.value)}
                  placeholder="e.g. ARC180990"
                  className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  required
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    className="flex h-11 w-full rounded-md border border-input bg-background px-3 pr-10 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {error && (
                <div className="rounded-md bg-destructive/10 border border-destructive/20 px-4 py-3">
                  <p className="text-sm text-destructive font-medium">{error}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 rounded-md bg-primary px-6 py-3 text-base font-semibold text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" />
                    Verifying...
                  </>
                ) : (
                  <>
                    <LogIn className="h-5 w-5" />
                    Login
                  </>
                )}
              </button>
            </form>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default Login;
