import path from "path";

export interface AppConfig {
  databasePath: string;
  savesSearchPaths: string[];
}

const userProfile = process.env.USERPROFILE || process.env.HOME || "";

export const config: AppConfig = {
  databasePath: process.env.DATABASE_URL || path.join(process.cwd(), "data", "touchline.db"),
  savesSearchPaths: [
    // Both titles' folders, kept in step with the parser's own candidate list. FC 26 writes its
    // saves under a different folder and file-name pattern to FC 25, so assuming either one alone
    // finds nothing for half of users.
    path.join(userProfile, "Documents", "FC 26", "settings"),
    path.join(userProfile, "Documents", "FC 25", "settings"),
    path.join(userProfile, "OneDrive", "Documents", "FC 26", "settings"),
    path.join(userProfile, "OneDrive", "Documents", "FC 25", "settings"),
    path.join(userProfile, "AppData", "Local", "EA SPORTS FC 26"),
    path.join(userProfile, "AppData", "Local", "EA SPORTS FC 25"),
    path.join(process.cwd(), "data", "saves"),
  ],
};