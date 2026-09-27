import type { Request, Response } from 'express';
import type { ProfileService } from '../services/profile.service';
import type {
  CreateProfileInput,
  ImportResumeInput,
  ProfileData,
  UpdateProfileInput,
} from '../types/profile.types';
import { assertNonEmptyString, assertObject, assertUuid } from '../utils/validation';
/**
 * REST adapter: translates HTTP <-> ProfileService calls.
 *
 * Controllers only parse/validate input, call the service and shape the HTTP
 * response. No business rules here. Errors thrown by the service propagate to
 * the error middleware (Express 5 forwards async errors automatically).
 */
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  createProfile = async (req: Request, res: Response): Promise<void> => {
    assertObject(req.body, 'Request body');
    assertNonEmptyString(req.body.name, 'name');
    assertNonEmptyString(req.body.email, 'email');
    const input: CreateProfileInput = { name: req.body.name, email: req.body.email };
    const profile = await this.profileService.createProfile(input);
    res.status(201).json(profile);   // 201 Created
  };

  importResume = async (req: Request, res: Response): Promise<void> => {
    // TODO 14: The frontend uploads a file (multipart/form-data), which
    // express.json() can't read. Add an upload middleware (e.g. multer) and
    // build the ImportResumeInput from the uploaded file.
    const input = req.body as ImportResumeInput;
    const extracted = await this.profileService.importResume(input);
    res.json(extracted);
  };

  confirmProfile = async (req: Request<{ candidateId: string }>, res: Response): Promise<void> => {
    assertUuid(req.params.candidateId, 'candidateId');
    assertObject(req.body, 'Request body');
    assertObject(req.body.profile, 'profile');
    assertNonEmptyString(req.body.profile.name, 'profile.name');
    const profile = req.body.profile as unknown as ProfileData;
    const saved = await this.profileService.confirmExtractedProfile({
      candidateId: req.params.candidateId,
      profile,
    });
    res.json(saved);
  };

  updateProfile = async (req: Request<{ candidateId: string }>, res: Response): Promise<void> => {
    // TODO 10: Validate the path param and req.body.
    assertUuid(req.params.candidateId,'candidateId');
    const changes = req.body as UpdateProfileInput;
    const profile = await this.profileService.updateProfile(req.params.candidateId, changes);
    res.json(profile);
  };

  deleteSkill = async (req: Request<{ candidateId: string; skillName: string }>, res: Response): Promise<void> => {
    assertUuid(req.params.candidateId, 'candidateId');
    await this.profileService.deleteSkill(req.params.candidateId, req.params.skillName);
    res.status(204).end();   // 204 No Content: success, empty body
  };

  getProfile = async (req: Request<{ candidateId: string }>, res: Response): Promise<void> => {
    assertUuid(req.params.candidateId,'candidateId');
    const profile = await this.profileService.getProfile(req.params.candidateId);
    res.json(profile);
  };
}
