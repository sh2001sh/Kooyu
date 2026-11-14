/** Native skill locations managed from the engine settings page. */
export interface HarnessSkillDirectory {
  path: string;
  label: string;
  exists: boolean;
  shared: boolean;
  writable: boolean;
  custom?: boolean;
}
export interface HarnessSkill {
  path: string;
  directory: string;
  name: string;
  description: string;
  enabled: boolean;
  version: string;
  writable: boolean;
  issue?: string;
}
export interface HarnessSkillListing {
  directories: HarnessSkillDirectory[];
  skills: HarnessSkill[];
  warnings: string[];
}
export interface HarnessSkillFile extends HarnessSkill {
  content: string;
}
