import { createContext, useContext, useState, ReactNode, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface Employee {
  employeeId: string;
  name: string;
  department: string;
  role?: string;
  office_id?: string | null;
}

export interface Office {
  id: string;
  name: string;
  short: string;
}

interface SupabaseSession {
  access_token: string;
  refresh_token: string;
}

interface ProfileRow {
  first_name: string | null;
  last_name: string | null;
  role: string;
  employee_code: string | null;
  office_id: string | null;
}

interface OfficeRow {
  id: string;
  name: string;
}

interface AuthContextType {
  employee: Employee | null;
  office: Office | null;
  login: (employee: Employee, session?: SupabaseSession | null) => Promise<void>;
  logout: () => Promise<void>;
  isAuthenticated: boolean;
  isInitializing: boolean;
  setOfficeState: (office: Office) => void;
}

const AuthContext = createContext<AuthContextType>({
  employee: null,
  office: null,
  login: async () => {},
  logout: async () => {},
  isAuthenticated: false,
  isInitializing: true,
  setOfficeState: () => {},
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [employee, setEmployee] = useState<Employee | null>(() => {
    const stored = sessionStorage.getItem("arcolab_employee");
    return stored ? JSON.parse(stored) : null;
  });

  const [office, setOffice] = useState<Office | null>(() => {
    const stored = sessionStorage.getItem("arcolab_office");
    return stored ? JSON.parse(stored) : null;
  });

  // True while waiting for the async Supabase session check on mount.
  // ProtectedRoute must wait for this to be false before deciding to redirect.
  const [isInitializing, setIsInitializing] = useState(true);

  useEffect(() => {
    const syncSession = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          const { data: profileData, error } = await supabase
            .from("profiles" as never)
            .select("first_name, last_name, role, employee_code, office_id")
            .eq("id", session.user.id)
            .maybeSingle();

          const profile = profileData as ProfileRow | null;

          if (profile && !error) {
            const emp: Employee = {
              employeeId: profile.employee_code || "",
              name: `${profile.first_name || ""} ${profile.last_name || ""}`.trim(),
              department: "Operational Excellence",
              role: profile.role,
              office_id: profile.office_id,
            };
            setEmployee(emp);
            sessionStorage.setItem("arcolab_employee", JSON.stringify(emp));

            if (profile.office_id) {
              const { data: officeResult } = await supabase
                .from("offices" as never)
                .select("id, name")
                .eq("id", profile.office_id)
                .maybeSingle();
              const officeData = officeResult as OfficeRow | null;
              if (officeData) {
                const mappedOffice = {
                  id: officeData.id,
                  name: officeData.name,
                  short: officeData.name.split(" ")[0],
                };
                setOffice(mappedOffice);
                sessionStorage.setItem("arcolab_office", JSON.stringify(mappedOffice));
              }
            }
          }
        } else {
          // No active Supabase session — clear any stale sessionStorage data
          sessionStorage.removeItem("arcolab_employee");
          sessionStorage.removeItem("arcolab_office");
          setEmployee(null);
          setOffice(null);
        }
      } catch (err) {
        console.error("Failed to sync session on mount:", err);
      } finally {
        setIsInitializing(false);
      }
    };
    syncSession();
  }, []);

  const login = async (emp: Employee, session?: SupabaseSession | null) => {
    setEmployee(emp);
    sessionStorage.setItem("arcolab_employee", JSON.stringify(emp));

    if (session) {
      const { error } = await supabase.auth.setSession({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
      });
      if (error) {
        console.error("Error establishing Supabase session:", error);
      }
    }

    if (emp.office_id) {
      try {
        const { data: officeResult } = await supabase
          .from("offices" as never)
          .select("id, name")
          .eq("id", emp.office_id)
          .maybeSingle();
        const officeData = officeResult as OfficeRow | null;
        if (officeData) {
          const mappedOffice = {
            id: officeData.id,
            name: officeData.name,
            short: officeData.name.split(" ")[0],
          };
          setOffice(mappedOffice);
          sessionStorage.setItem("arcolab_office", JSON.stringify(mappedOffice));
        }
      } catch (err) {
        console.error("Error loading office during login:", err);
      }
    } else {
      const storedOffice = sessionStorage.getItem("arcolab_office");
      if (storedOffice) setOffice(JSON.parse(storedOffice));
    }
  };

  const logout = async () => {
    setEmployee(null);
    setOffice(null);
    sessionStorage.removeItem("arcolab_employee");
    sessionStorage.removeItem("arcolab_office");
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.error("Error signing out from Supabase:", err);
    }
  };

  const setOfficeState = (off: Office) => {
    setOffice(off);
    sessionStorage.setItem("arcolab_office", JSON.stringify(off));
    if (employee) {
      const updatedEmp = { ...employee, office_id: off.id };
      setEmployee(updatedEmp);
      sessionStorage.setItem("arcolab_employee", JSON.stringify(updatedEmp));
    }
  };

  return (
    <AuthContext.Provider
      value={{
        employee,
        office,
        login,
        logout,
        isAuthenticated: !!employee,
        isInitializing,
        setOfficeState,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

