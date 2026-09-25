import type { Request, Response } from 'express';
import type { ProfileService } from '../services/profile.service';
import type {
  ConfirmProfileInput,
  ImportResumeInput,
  UpdateProfileInput,
} from '../types/profile.types';

/**
 * REST adapter: translates HTTP <-> ProfileService calls.
 *
 * Controllers only parse/validate input, call the service and shape the HTTP
 * response. No business rules here. Errors thrown by the service propagate to
 * the error middleware (Express 5 forwards async errors automatically).
 */
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  importResume = async (req: Request, res: Response): Promise<void> => {
    // TODO 10: Validate req.body before trusting it.
    const input = req.body as ImportResumeInput;
    const profile = await this.profileService.importResume(input);
    res.status(201).json(profile);
  };

  confirmProfile = async (req: Request, res: Response): Promise<void> => {
    // TODO 10: Validate req.body before trusting it.
    const input = req.body as ConfirmProfileInput;
    const profile = await this.profileService.confirmExtractedProfile(input);
    res.json(profile);
  };

  updateProfile = async (req: Request<{ candidateId: string }>, res: Response): Promise<void> => {
    // TODO 10: Validate the path param and req.body.
    const changes = req.body as UpdateProfileInput;
    const profile = await this.profileService.updateProfile(req.params.candidateId, changes);
    res.json(profile);
  };

  getProfile = async (req: Request<{ candidateId: string }>, res: Response): Promise<void> => {
    // TODO 10: Validate the path param.
    const profile = await this.profileService.getProfile(req.params.candidateId);
    res.json(profile);
  };
}
