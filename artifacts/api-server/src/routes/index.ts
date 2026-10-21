import { Router, type IRouter } from "express";
import healthRouter from "./health";
import libraryRouter from "./library";
import briefsRouter from "./briefs";
import casesRouter from "./cases";
import overviewRouter from "./overview";
import workbenchRouter from "./workbench";
import reuseRouter from "./reuse";
import prototypesRouter from "./prototypes";
import authRouter from "./auth";
import intakeRouter from "./intake";
import intakeFilesRouter from "./intake-files";
import solutionCodeRouter from "./solution-code";
import codeAssessmentRouter from "./code-assessment";

const router: IRouter = Router();
router.use(authRouter);
router.use(solutionCodeRouter);
router.use(codeAssessmentRouter);
router.use(intakeFilesRouter);
router.use(intakeRouter);

router.use(healthRouter);
router.use(libraryRouter);
router.use(briefsRouter);
router.use(casesRouter);
router.use(overviewRouter);
router.use(workbenchRouter);
router.use(reuseRouter);
router.use(prototypesRouter);

export default router;
