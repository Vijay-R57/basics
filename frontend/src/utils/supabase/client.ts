import { createBrowserClient } from "@supabase/ssr";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || (typeof process !== "undefined" ? process.env.NEXT_PUBLIC_SUPABASE_URL : undefined);
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || (typeof process !== "undefined" ? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY : undefined);

export const createClient = () =>
  createBrowserClient(
    supabaseUrl!,
    supabaseKey!
  );
