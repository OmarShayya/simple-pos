import { Router } from "express";
import authRoutes from "./auth.routes";
import categoryRoutes from "./category.routes";
import productRoutes from "./product.routes";
import customerRoutes from "./customer.routes";
import saleRoutes from "./sale.routes";

const router = Router();

router.get("/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "POS System API is running",
    timestamp: new Date().toISOString(),
  });
});

router.use("/auth", authRoutes);
router.use("/categories", categoryRoutes);
router.use("/products", productRoutes);
router.use("/customers", customerRoutes);
router.use("/sales", saleRoutes);

export default router;
