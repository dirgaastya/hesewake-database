import {
  Bug, ClipboardList, Contact, Database, File, GraduationCap, KeyRound, LayoutTemplate, Lightbulb, Link2,
  ListChecks, Server, Settings2, StickyNote, Table2, Terminal, Users, Webhook,
} from 'lucide-react';

export const TYPE_ICON = {
  note: StickyNote,
  idea: Lightbulb,
  learning: GraduationCap,
  meeting: Users,
  template: LayoutTemplate,
  sop: ListChecks,
  query: Database,
  command: Terminal,
  config: Settings2,
  api_request: Webhook,
  schema: Table2,
  error_solution: Bug,
  worklog: ClipboardList,
  contact: Contact,
  server: Server,
  link: Link2,
  file: File,
  secret: KeyRound,
};
