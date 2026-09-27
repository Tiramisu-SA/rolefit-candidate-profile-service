import type { Request, Response } from 'express';
import type { ProfileService } from '../services/profile.service';
import type { ChildKind } from '../types/profile.types';

type ChildParams = { id: string };

/**
 * REST adapter: translates HTTP <-> ProfileService calls.
 *
 * Controllers only read the request and shape the HTTP response. Validation
 * and business rules live in ProfileService. Errors propagate to the error
 * middleware (Express 5 forwards async errors automatically).
 */
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  // --- profile ---

  getProfile = async (req: Request, res: Response) => {
    res.json(await this.profileService.getProfile(req.userId!));
  };

  createProfile = async (req: Request, res: Response) => {
    res.status(201).json(await this.profileService.createProfile(req.userId!, req.body));
  };

  updateBasics = async (req: Request, res: Response) => {
    res.json(await this.profileService.updateBasics(req.userId!, req.body));
  };

  deleteProfile = async (req: Request, res: Response) => {
    await this.profileService.deleteProfile(req.userId!);
    res.status(204).end();
  };

  // --- child collections ---

  listChildren = (kind: ChildKind) => async (req: Request, res: Response) => {
    res.json(await this.profileService.listChildren(req.userId!, kind));
  };

  addChild = (kind: ChildKind) => async (req: Request, res: Response) => {
    res.status(201).json(await this.profileService.addChild(req.userId!, kind, req.body));
  };

  updateChild = (kind: ChildKind) => async (req: Request<ChildParams>, res: Response) => {
    res.json(await this.profileService.updateChild(req.userId!, kind, req.params.id, req.body));
  };

  deleteChild = (kind: ChildKind) => async (req: Request<ChildParams>, res: Response) => {
    await this.profileService.deleteChild(req.userId!, kind, req.params.id);
    res.status(204).end();
  };

  // --- preferences ---

  getPreferences = async (req: Request, res: Response) => {
    res.json(await this.profileService.getPreferences(req.userId!));
  };

  savePreferences = async (req: Request, res: Response) => {
    res.json(await this.profileService.savePreferences(req.userId!, req.body));
  };

  deletePreferences = async (req: Request, res: Response) => {
    await this.profileService.deletePreferences(req.userId!);
    res.status(204).end();
  };

  // --- resume import / confirm ---

  /** Body is the raw file; Content-Type is its MIME type; X-File-Name is URI-encoded. */
  importResume = async (req: Request, res: Response) => {
    const contentType = (req.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    const content = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const result = await this.profileService.importResume(req.userId!, {
      fileName: decodeFileName(req.get('x-file-name')),
      contentType,
      content,
    });
    res.json(result);
  };

  confirmProfile = async (req: Request, res: Response) => {
    res.json(await this.profileService.confirmProfile(req.userId!, req.body));
  };
}

function decodeFileName(header: string | undefined): string {
  if (!header) return 'resume';
  try {
    return decodeURIComponent(header).slice(0, 255) || 'resume';
  } catch {
    return header.slice(0, 255);
  }
}
