import { claim } from "./claim";
import { deleteTaskCommand } from "./delete";
import { done } from "./done";
import { free } from "./free";
import { tasks } from "./tasks";

export const taskCommands = [claim, tasks, done, free, deleteTaskCommand];
