import bcrypt from "bcrypt";
import { NextApiRequest, NextApiResponse } from "next";

import { prisma } from "src/db";
import { apiResponse } from "src/types/api-response";
import { handlerMapping } from "src/utils/api-helpers";
import { isDemoMode } from "src/utils/demo-helpers";
import { getPlatform } from "src/utils/platform";
import stripeClient from "src/utils/stripe-loader";
import validationSchemas from "src/utils/validation_schemas";

const handler = async (req: NextApiRequest, res: NextApiResponse) =>
  handlerMapping(req, res, {
    POST: register,
  });

const register = async (req: NextApiRequest, res: NextApiResponse) => {
  const { email, password, country } = req.body;

  try {
    await validationSchemas.user.validate(
      { email, password, country },
      { abortEarly: false },
    );
  } catch (error) {
    return res.status(400).json(
      apiResponse({
        success: false,
        error: { message: (error as Error).message },
      }),
    );
  }

  // Check if user exists
  const user = await prisma.user.findFirst({ where: { email } });
  if (user) {
    return res.status(400).json(
      apiResponse({
        success: false,
        error: { message: "Account already exists" },
      }),
    );
  }

  // Create a Connected Account
  const platform = getPlatform(country);
  const stripe = stripeClient(platform);
  const account = await stripe.accounts.create({
    type: "custom",
    country: country,
    email: email,
    ...(isDemoMode() && {
      // FOR-DEMO-ONLY: We're hardcoding the business type to individual. You should either remove this line or modify it
      // to collect the real business type from the user.
      business_type: "individual",
      // FOR-DEMO-ONLY: We're hardcoding the SSN to 000-00-0000 (Test SSN docs: https://stripe.com/docs/connect/testing#test-personal-id-numbers).
      // You should either remove this line or modify it to collect the actual SSN from the user in a real application.
      individual: {
        id_number: "000000000",
      },
    }),
    capabilities: {
      transfers: { requested: true },
      card_issuing: { requested: true },
    },
  });

  // Create the user
  const hashedPassword = await bcrypt.hash(password, 10);
  await prisma.user.create({
    data: {
      email: email,
      password: hashedPassword,
      accountId: account.id,
      country,
    },
  });

  return res.status(200).json(apiResponse({ success: true }));
};

export default handler;
