import type { Workspace } from '../domain/contracts.ts';
// Copy of contracts/v1/fixtures/workspace.json, guarded by equality test.
export const publicWorkspace: Workspace = {
  "jobs": [],
  "legacy_history": [],
  "link": null,
  "notebook": {
    "id": "notebook:synthetic",
    "name": "Public synthetic workspace"
  },
  "notes": [
    {
      "content": "Saved synthetic note",
      "id": "note:synthetic",
      "revision": 1,
      "title": "Synthetic revision example"
    }
  ],
  "selection": null,
  "sources": [],
  "turns": []
};
