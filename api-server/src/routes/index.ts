import agentDownloadRouter from "./agent-download";
import { Router, type IRouter } from "express";
import healthRouter from "./health";
import conversationsRouter from "./conversations";
import foldersRouter from "./folders";
import chatRouter from "./chat";
import settingsRouter from "./settings";
import authRouter from "./auth";
import agentRouter from "./agent";
import feedbackRouter from "./feedback";
import paymentsRouter from "./payments";

const router: IRouter = Router();

router.use(healthRouter);
router.use(agentDownloadRouter);
router.use(authRouter);
router.use(conversationsRouter);
router.use(foldersRouter);
router.use(chatRouter);
router.use(settingsRouter);
router.use(agentRouter);
router.use(feedbackRouter);
router.use(paymentsRouter);

export default router;
