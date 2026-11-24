import { Response, NextFunction } from "express";
import { CustomRequest } from "../types";
import authService from "../services/auth.service";
import { ApiResponseUtil } from "../utils/apiResponse";
import { RegisterDto, LoginDto, UpdateUserDto } from "../dtos/auth.dto";
import { ApiError } from "../utils/apiError";
import { UserRole } from "../models/user.model";

class AuthController {
  async getSetupStatus(req: CustomRequest, res: Response, next: NextFunction) {
    const users = await authService.countUsers();
    return ApiResponseUtil.success(res, { needsSetup: users === 0 }, "Setup status retrieved");
  }

  /**
   * First run: anyone can create the first account (always an admin).
   * Afterwards only signed-in admins (any role) and managers (cashiers only) can create accounts.
   */
  async register(req: CustomRequest, res: Response, next: NextFunction) {
    const { name, email, password, role }: RegisterDto = req.body;
    const isFirstUser = (await authService.countUsers()) === 0;

    let effectiveRole: UserRole;
    if (isFirstUser) {
      effectiveRole = UserRole.ADMIN;
    } else {
      if (!req.user) {
        throw ApiError.forbidden("Registration is closed. Ask an admin to create your account.");
      }
      effectiveRole = role ?? UserRole.CASHIER;
      if (req.user.role === UserRole.CASHIER) {
        throw ApiError.forbidden("Only admins and managers can create accounts");
      }
      if (req.user.role === UserRole.MANAGER && effectiveRole !== UserRole.CASHIER) {
        throw ApiError.forbidden("Managers can only create cashier accounts");
      }
    }

    const { user, token } = await authService.register(
      name,
      email,
      password,
      effectiveRole
    );

    return ApiResponseUtil.created(
      res,
      {
        user: {
          id: user._id.toString(),
          name: user.name,
          email: user.email,
          role: user.role,
        },
        token,
      },
      "User registered successfully"
    );
  }

  async login(req: CustomRequest, res: Response, next: NextFunction) {
    const { email, password }: LoginDto = req.body;
    const { user, token } = await authService.login(email, password);

    return ApiResponseUtil.success(
      res,
      {
        user: {
          id: user._id.toString(),
          name: user.name,
          email: user.email,
          role: user.role,
        },
        token,
      },
      "Login successful"
    );
  }

  async getProfile(req: CustomRequest, res: Response, next: NextFunction) {
    const user = await authService.getUserById(req.user!.id);

    return ApiResponseUtil.success(
      res,
      {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        role: user.role,
      },
      "Profile retrieved successfully"
    );
  }

  async getAllUsers(req: CustomRequest, res: Response, next: NextFunction) {
    const users = await authService.getAllUsers(req.query.includeInactive === "true");

    return ApiResponseUtil.success(
      res,
      users.map((user) => ({
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        role: user.role,
        isActive: user.isActive,
        createdAt: user.createdAt,
      })),
      "Users retrieved successfully"
    );
  }

  async updateUser(req: CustomRequest, res: Response, next: NextFunction) {
    const { id } = req.params;
    const updates: UpdateUserDto = req.body;
    const user = await authService.updateUser(id, updates, req.user?.id);

    return ApiResponseUtil.success(
      res,
      {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        role: user.role,
        isActive: user.isActive,
      },
      "User updated successfully"
    );
  }

  async deactivateUser(req: CustomRequest, res: Response, next: NextFunction) {
    const { id } = req.params;
    await authService.deactivateUser(id, req.user?.id);
    return ApiResponseUtil.noContent(res);
  }
}

export default new AuthController();
