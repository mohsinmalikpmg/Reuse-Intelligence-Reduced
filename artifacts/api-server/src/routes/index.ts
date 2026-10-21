import { Router, type IRouter } from "express";
import healthRouter from "./health";
import libraryRouter from "./library";
import briefsRouter from "./briefs";
import casesRouter from "./cases";
import overviewRouter from "./overview";
import workbenchRouter from "./workbench";

const router: IRouter = Router();

router.use(healthRouter);
router.use(libraryRouter);
router.use(briefsRouter);
router.use(casesRouter);
router.use(overviewRouter);
router.use(workbenchRouter);

export default router;
