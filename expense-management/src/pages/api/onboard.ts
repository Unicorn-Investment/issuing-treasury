import { NextApiRequest, NextApiResponse } from "next";
import Stripe from "stripe";

import { apiResponse } from "src/types/api-response";
import FinancialProduct from "src/types/financial_product";
import { handlerMapping } from "src/utils/api-helpers";
import { isDemoMode, TOS_ACCEPTANCE } from "src/utils/demo-helpers";
import { createAccountOnboardingUrl } from "src/utils/onboarding-helpers";
import { getSessionForServerSide } from "src/utils/session-helpers";
import stripeClient from "src/utils/stripe-loader";
import validationSchemas from "src/utils/validation_schemas";

const handler = async (req: NextApiRequest, res: NextApiResponse) =>
  handlerMapping(req, res, {
    POST: onboard,
  });

const onboard = async (req: NextApiRequest, res: NextApiResponse) => {
  const session = await getSessionForServerSide(req, res);
  const { email, stripeAccount, country, financialProduct } = session;
  const { accountId, platform } = stripeAccount;

  const {
    businessName,
    skipOnboarding,
  }: { businessName: string; skipOnboarding?: boolean } = req.body;

  let validationSchema;
  if (isDemoMode()) {
    validationSchema = validationSchemas.business.withOnbardingSkip;
  } else {
    validationSchema = validationSchemas.business.default;
  }

  try {
    await validationSchema.validate(
      { businessName, skipOnboarding },
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

  const onboardingData: Stripe.AccountUpdateParams = {
    business_profile: { name: businessName },
    // TODO: Only update the fields during the demo that are outstanding to speed things up
    // FOR-DEMO-ONLY: We're using fake data for illustrative purposes in this demo. The fake data will be used to bypass
    // showing the Stripe Connect Onboarding forms. In a real application, you would not do this so that you can collect
    // the real KYC data from your users.
    ...(isDemoMode() && {
      business_type: "individual",
      business_profile: {
        name: businessName,
        // Merchant category code for "computer software stores" (https://fs.fldfs.com/iwpapps/pcard/docs/MCCs.pdf)
        mcc: "5734",
        product_description: "Some demo product",
        url: "https://some-company.com",
      },
      company: {
        name: businessName,
        // Fake business TIN: https://stripe.com/docs/connect/testing#test-business-tax-ids
        tax_id: "000000000",
      },
      individual: {
        address: {
          // This value causes the address to be verified in testmode: https://stripe.com/docs/connect/testing#test-verification-addresses
          line1: "address_full_match",
          ...(country === "US" && {
            city: "South San Francisco",
            state: "CA",
            postal_code: "94080",
          }),
          ...(country === "GB" && {
            city: "London",
            postal_code: "WC32 4AP",
          }),
          country: country,
        },
        // These values together cause the DOB to be verified in testmode: https://stripe.com/docs/connect/testing#test-dobs
        dob: {
          day: 1,
          month: 1,
          year: 1901,
        },
        email: email,
        first_name: "John",
        last_name: "Smith",
        // Fake phone number: https://stripe.com/docs/connect/testing
        // TODO: Normally 000-000-0000 is a valid testmode phone number, but it's currently broken. Once Stripe fixes
        // it, we can change back to 000-000-0000. For now, this is a fake number that will pass validation.
        phone: "2015550123",
      },
      ...(skipOnboarding && { tos_acceptance: TOS_ACCEPTANCE }),
      // Faking Terms of Service acceptances
      settings: {
        card_issuing: {
          tos_acceptance: TOS_ACCEPTANCE,
        },
        // Embedded Finance is a full financial services stack for your users:
        // accounts[0] with Treasury to store and send funds, with cards[1] with
        // Issuing for spending.
        // This is different from the Expense Management example, where you
        // top up balances[2] to fund spend on Issuing cards.
        //
        // [0] https://stripe.com/docs/treasury/account-management/financial-accounts
        // [1] https://stripe.com/docs/issuing/how-issuing-works
        // [2] https://stripe.com/docs/issuing/adding-funds-to-your-card-program
        ...(financialProduct == FinancialProduct.EmbeddedFinance && {
          treasury: {
            tos_acceptance: TOS_ACCEPTANCE,
          },
        }),
      },
    }),
  };

  const stripe = stripeClient(platform);
  await stripe.accounts.update(accountId, onboardingData);

  // FOR-DEMO-ONLY: We're going to check if the user wants to skip the onboarding process. If they do, we'll redirect to
  // the home page. In a real application, you would not allow this bypass so that you can collect the real KYC data
  // from your users.
  if (isDemoMode() && skipOnboarding) {
    return res
      .status(200)
      .json(apiResponse({ success: true, data: { redirectUrl: "/" } }));
  }

  // This is the Connect Onboarding URL that will be used to collect KYC information from the user
  const onboardingUrl = await createAccountOnboardingUrl(stripeAccount);

  return res
    .status(200)
    .json(apiResponse({ success: true, data: { redirectUrl: onboardingUrl } }));
};

export default handler;