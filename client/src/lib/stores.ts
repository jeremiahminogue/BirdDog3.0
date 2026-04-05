import { writable } from "svelte/store";

export interface User {
  id: number;
  username: string;
  displayName: string;
  role: "super_admin" | "admin" | "pm" | "readonly";
  companyId: number | null;
}

export interface AppSettings {
  companyName: string;
  companyShort: string;
}

export const user = writable<User | null>(null);
export const currentPage = writable("board");
export const appSettings = writable<AppSettings>({ companyName: "", companyShort: "" });
export const selectedEmployeeId = writable<number | null>(null);
export const sidebarCollapsed = writable(false);
