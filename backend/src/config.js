import dotenv from "dotenv";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

if (!process.env.OPENAI_API_KEY) throw new Error("Missing env AI API KEY");

export const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Create a single supabase client for interacting with your database
if (!process.env.SUPABASE_URL) throw new Error("Missing env SUPABASE URL");
if (!process.env.SUPABASE_API_KEY) throw new Error("Missing env SUPABASE KEY");

export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_API_KEY,
);
