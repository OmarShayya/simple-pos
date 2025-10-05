import { Response, NextFunction } from "express";
import { CustomRequest } from "../types";
import authService from "../services/auth.service";
import { ApiResponseUtil } from "../utils/apiResponse";
import { RegisterDto, LoginDto, UpdateUserDto } from "../dtos/auth.dto";

class AuthController {
  async register(req: CustomRequest, res: Response, next: NextFunction) {
    const { name, email, password, role }: RegisterDto = req.body;
    const { user, token } = await authService.register(
      name,
      email,
      password,
      role
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
    const users = await authService.getAllUsers();

    return ApiResponseUtil.success(
      res,
      users.map((user) => ({
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        role: user.role,
        createdAt: user.createdAt,
      })),
      "Users retrieved successfully"
    );
  }

  async updateUser(req: CustomRequest, res: Response, next: NextFunction) {
    const { id } = req.params;
    const updates: UpdateUserDto = req.body;
    const user = await authService.updateUser(id, updates);

    return ApiResponseUtil.success(
      res,
      {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        role: user.role,
      },
      "User updated successfully"
    );
  }

  async deactivateUser(req: CustomRequest, res: Response, next: NextFunction) {
    const { id } = req.params;
    await authService.deactivateUser(id);
    return ApiResponseUtil.noContent(res);
  }
}

export default new AuthController();
