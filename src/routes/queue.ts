import { Router } from 'express';

const router = Router();

// Queue work is intentionally quarantined from the judged API surface.
// This router is not mounted by src/index.ts and exports no public endpoints.

export default router;
