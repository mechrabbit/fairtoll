import { settle } from "../../../../facilitator.js";

export const POST = async (request) => Response.json(settle(await request.json()));
