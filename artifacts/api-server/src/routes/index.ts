import { Router, type IRouter } from "express";
import healthRouter from "./health";
import libraryRouter from "./library";
import briefsRouter from "./briefs";
import casesRouter from "./cases";
import overviewRouter from "./overview";

const router: IRouter = Router();

router.use(healthRouter);
router.use(libraryRouter);
router.use(briefsRouter);
router.use(casesRouter);
router.use(overviewRouter);

export default router;
